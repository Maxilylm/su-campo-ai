-- GOAL-audit-2026-09 P2 "Execute multi-op AI batches atomically".
--
-- executeOperations (src/lib/ai.ts) applied a confirmed AI proposal one
-- PostgREST call at a time, so a failure at op 3 of 5 left ops 1-2 written;
-- retrying the message then wrote them twice. apply_ai_operations runs the
-- whole batch in one transaction: every op commits, or none does.
--
-- Division of labour. The TypeScript side still does ALL validation first
-- (table/action allowlists, column allowlists, value checks, farm-relation
-- checks, stock and link checks, match-by-single-id, the expectedUpdatedAt
-- snapshot) and only then sends the already-prepared ops here. This function
-- re-checks what a stale read could get wrong: farm_id on every row it
-- touches or references, the optimistic-concurrency anchor, and the links
-- that must stay managed from inventory. Cattle moves, weighings and priced
-- purchases call the existing move_cattle / record_weight /
-- record_inventory_purchase functions, so their semantics stay in one place.
--
-- Op shapes (p_ops is a JSON array, applied in order):
--   {"kind":"insert","table":T,"data":{...},"placeholder":"NEW_SECTION_x"?}
--   {"kind":"update","table":T,"id":ID,"data":{...},"expected_updated_at":TS}
--   {"kind":"delete","table":T,"id":ID,"expected_updated_at":TS}
--   {"kind":"move","source_id":ID,"destination_section_id":ID,"move_count":N,"idempotency_key":K?}
--   {"kind":"weight","cattle_id":ID,"date":D,"weight_kg":N,"notes":S?}
--   {"kind":"purchase","item_id":ID,"quantity":N,"unit_cost":N,"currency":C,"date":D,
--    "section_id":ID?,"crop_id":ID?,"cattle_id":ID?,"notes":S?}
-- A section insert may carry a placeholder; any later string value equal to
-- it (data values, a move destination, a purchase section) becomes the new id.
--
-- Result: a JSON array with one object per op, in order:
--   {"index":i,"kind":K,"table":T,"id":ID,"move_mode":M?,"moved_count":N?}
-- On failure the whole call raises, keeping the original SQLSTATE and
-- message, with DETAIL = {"op_index":i} and HINT = a machine-readable reason
-- for the checks raised here ('stale', 'not_found', 'linked', ...), so the
-- caller can report which op failed and that nothing was saved.
--
-- Retries. With p_idempotency_key the committed result is stored in
-- ai_operation_batches; a retry of the same request returns it instead of
-- applying the batch again (purged after 30 days with the other retry keys).
--
-- Lock order (see migration 049 for the deadlock this avoids repeating):
--   1. a per-farm transaction advisory lock: two AI batches for one farm never
--      interleave, so opposite batches cannot wait on each other;
--   2. every row the batch will update, delete, move, weigh or restock, sorted
--      by (table, id), FOR UPDATE where the op needs it (delete, move source,
--      priced purchase item -- the modes move_cattle and
--      record_inventory_purchase take) and FOR NO KEY UPDATE otherwise;
--   3. then the ops in order; their triggers take section_occupancy ->
--      grazing_periods -> grazing_period_peaks as in 049.
-- A single-row UI write (move_cattle, a weighing, a stock movement) holds at
-- most one of the rows in step 2 when it starts, and the batch takes all of
-- them before any trigger row, so the two cannot wait on each other.
CREATE TABLE IF NOT EXISTS public.ai_operation_batches (
  farm_id UUID NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  results JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (farm_id, idempotency_key)
);

ALTER TABLE public.ai_operation_batches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access" ON public.ai_operation_batches;
CREATE POLICY "Service role full access" ON public.ai_operation_batches
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE public.ai_operation_batches FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.apply_ai_operations(
  p_farm_id UUID,
  p_ops JSONB,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  -- Tables each kind may reach. Mirrors AI_MUTABLE_TABLES / AI_UPDATED_AT_TABLES
  -- in src/lib/ai.ts; weight_records and priced purchases have their own kinds.
  c_insert_tables CONSTANT TEXT[] := ARRAY['sections','cattle','activities','vaccinations','health_events','crops','crop_applications','inventory_items','inventory_movements','financial_transactions','tasks'];
  c_update_tables CONSTANT TEXT[] := ARRAY['sections','cattle','activities','vaccinations','health_events','crops','crop_applications','inventory_items','financial_transactions','tasks'];
  -- Reference columns re-checked against p_farm_id on every insert/update.
  c_relations CONSTANT JSONB := '{"section_id":"sections","cattle_id":"cattle","crop_id":"crops","item_id":"inventory_items","inventory_movement_id":"inventory_movements"}';
  -- Index of the op being applied, for the error DETAIL. Assigned inside the
  -- loop: an integer FOR loop variable is local to the loop, so it would be
  -- out of scope (or shadowed) in the EXCEPTION handler.
  v_index INTEGER := -1;
  v_i INTEGER;
  v_op JSONB;
  v_kind TEXT;
  v_table TEXT;
  v_data JSONB;
  v_id UUID;
  v_new_id UUID;
  v_expected TIMESTAMPTZ;
  v_placeholders JSONB := '{}'::jsonb;
  v_results JSONB := '[]'::jsonb;
  v_result JSONB;
  v_key TEXT;
  v_value JSONB;
  v_cols TEXT;
  v_sets TEXT;
  v_lock RECORD;
  v_move RECORD;
  v_cached JSONB;
  v_state TEXT;
  v_message TEXT;
  v_hint TEXT;
BEGIN
  IF p_farm_id IS NULL OR NOT EXISTS (SELECT 1 FROM farms WHERE id = p_farm_id) THEN
    RAISE EXCEPTION 'farm not found' USING HINT = 'not_found';
  END IF;
  IF jsonb_typeof(p_ops) IS DISTINCT FROM 'array' OR jsonb_array_length(p_ops) > 20 THEN
    RAISE EXCEPTION 'p_ops must be an array of at most 20 operations' USING HINT = 'invalid';
  END IF;

  -- Lock order step 1: one AI batch per farm at a time.
  PERFORM pg_advisory_xact_lock(hashtextextended('apply_ai_operations:' || p_farm_id::text, 0));

  IF p_idempotency_key IS NOT NULL THEN
    SELECT results INTO v_cached FROM ai_operation_batches
      WHERE farm_id = p_farm_id AND idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN jsonb_build_object('replayed', true, 'results', v_cached);
    END IF;
  END IF;

  BEGIN
    -- Lock order step 2: every existing row the ops write, sorted. Rows that
    -- are missing or belong to another farm lock nothing here and fail in
    -- their op below. Placeholder ids (sections created by this batch) are
    -- skipped: nobody else can see those rows yet.
    FOR v_lock IN
      WITH targets(tbl, id_text, strong) AS (
        SELECT o->>'table', o->>'id', (o->>'kind') = 'delete'
          FROM jsonb_array_elements(p_ops) o WHERE o->>'kind' IN ('update', 'delete')
        UNION ALL
        SELECT 'cattle', o->>'source_id', true
          FROM jsonb_array_elements(p_ops) o WHERE o->>'kind' = 'move'
        UNION ALL
        SELECT 'cattle', o->>'cattle_id', false
          FROM jsonb_array_elements(p_ops) o WHERE o->>'kind' = 'weight'
        UNION ALL
        SELECT 'inventory_items', o->>'item_id', true
          FROM jsonb_array_elements(p_ops) o WHERE o->>'kind' = 'purchase'
        UNION ALL
        SELECT 'inventory_items', o->'data'->>'item_id', false
          FROM jsonb_array_elements(p_ops) o WHERE o->>'kind' = 'insert' AND o->>'table' = 'inventory_movements'
      )
      SELECT tbl, id_text::uuid AS id, bool_or(strong) AS strong
        FROM targets
       WHERE tbl = ANY (c_insert_tables)
         AND id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       GROUP BY tbl, id_text::uuid
       ORDER BY tbl, id_text::uuid
    LOOP
      EXECUTE format(
        'SELECT 1 FROM public.%I WHERE id = $1 AND farm_id = $2 FOR %s',
        v_lock.tbl, CASE WHEN v_lock.strong THEN 'UPDATE' ELSE 'NO KEY UPDATE' END
      ) USING v_lock.id, p_farm_id;
    END LOOP;

    -- Step 3: the ops, in order.
    FOR v_i IN 0 .. jsonb_array_length(p_ops) - 1 LOOP
      v_index := v_i;
      v_op := p_ops -> v_index;
      v_kind := v_op->>'kind';
      v_table := v_op->>'table';
      v_result := jsonb_build_object('index', v_index, 'kind', v_kind, 'table', v_table);

      IF v_kind IN ('insert', 'update') THEN
        IF v_kind = 'insert' AND NOT (v_table = ANY (c_insert_tables)) THEN
          RAISE EXCEPTION 'insert into % is not allowed', v_table USING HINT = 'invalid';
        END IF;
        IF v_kind = 'update' AND NOT (v_table = ANY (c_update_tables)) THEN
          RAISE EXCEPTION 'update of % is not allowed', v_table USING HINT = 'invalid';
        END IF;
        v_data := COALESCE(v_op->'data', '{}'::jsonb);
        IF jsonb_typeof(v_data) <> 'object' THEN
          RAISE EXCEPTION 'data must be an object' USING HINT = 'invalid';
        END IF;
        -- Never trust identity or bookkeeping columns from the payload.
        v_data := v_data - 'id' - 'farm_id' - 'created_at' - 'updated_at';

        -- Resolve placeholders, then re-check every reference column.
        FOR v_key, v_value IN SELECT * FROM jsonb_each(v_data) LOOP
          IF jsonb_typeof(v_value) = 'string' AND v_placeholders ? (v_value #>> '{}') THEN
            v_data := jsonb_set(v_data, ARRAY[v_key], v_placeholders -> (v_value #>> '{}'));
          END IF;
        END LOOP;
        FOR v_key, v_value IN SELECT * FROM jsonb_each(v_data) WHERE c_relations ? key LOOP
          CONTINUE WHEN jsonb_typeof(v_value) = 'null';
          EXECUTE format('SELECT id FROM public.%I WHERE id = $1 AND farm_id = $2', c_relations->>v_key)
            INTO v_new_id USING (v_value #>> '{}')::uuid, p_farm_id;
          IF v_new_id IS NULL THEN
            RAISE EXCEPTION '% does not belong to this farm', v_key USING HINT = 'relation';
          END IF;
        END LOOP;

        IF v_table = 'financial_transactions' AND v_data->>'category' = 'compra_insumo' THEN
          RAISE EXCEPTION 'supply purchases are recorded through inventory' USING HINT = 'linked';
        END IF;
        IF v_table = 'financial_transactions' AND v_data ? 'inventory_movement_id' THEN
          RAISE EXCEPTION 'inventory links are managed from inventory' USING HINT = 'linked';
        END IF;
        IF v_table = 'inventory_items' AND v_kind = 'update' AND v_data ? 'current_stock' THEN
          RAISE EXCEPTION 'stock changes through an inventory movement' USING HINT = 'linked';
        END IF;

        IF v_kind = 'insert' THEN
          v_data := v_data || jsonb_build_object('farm_id', p_farm_id);
          SELECT string_agg(format('%I', k), ', ' ORDER BY k) INTO v_cols FROM jsonb_object_keys(v_data) k;
          EXECUTE format(
            'INSERT INTO public.%I (%s) SELECT %s FROM jsonb_populate_record(NULL::public.%I, $1) RETURNING id',
            v_table, v_cols, v_cols, v_table
          ) INTO v_new_id USING v_data;
          v_result := v_result || jsonb_build_object('id', v_new_id);
          IF v_table = 'sections' AND v_op ? 'placeholder' THEN
            v_placeholders := v_placeholders || jsonb_build_object(v_op->>'placeholder', v_new_id);
          END IF;
        ELSE
          IF v_data = '{}'::jsonb THEN
            RAISE EXCEPTION 'update of % has no fields', v_table USING HINT = 'invalid';
          END IF;
          v_id := COALESCE(v_placeholders->>(v_op->>'id'), v_op->>'id')::uuid;
          v_expected := (v_op->>'expected_updated_at')::timestamptz;
          IF v_expected IS NULL THEN
            RAISE EXCEPTION 'update of % needs expected_updated_at', v_table USING HINT = 'stale';
          END IF;
          SELECT string_agg(format('%I = r.%I', k, k), ', ') INTO v_sets FROM jsonb_object_keys(v_data) k;
          EXECUTE format(
            'UPDATE public.%I AS t SET %s FROM jsonb_populate_record(NULL::public.%I, $1) AS r
              WHERE t.id = $2 AND t.farm_id = $3 AND t.updated_at = $4 %s RETURNING t.id',
            v_table, v_sets, v_table,
            CASE WHEN v_table = 'financial_transactions' THEN 'AND t.inventory_movement_id IS NULL' ELSE '' END
          ) INTO v_new_id USING v_data, v_id, p_farm_id, v_expected;
          IF v_new_id IS NULL THEN
            RAISE EXCEPTION '% % changed since the proposal', v_table, v_id USING HINT = 'stale';
          END IF;
          v_result := v_result || jsonb_build_object('id', v_new_id);
        END IF;

      ELSIF v_kind = 'delete' THEN
        IF NOT (v_table = ANY (c_update_tables)) THEN
          RAISE EXCEPTION 'delete from % is not allowed', v_table USING HINT = 'invalid';
        END IF;
        v_id := COALESCE(v_placeholders->>(v_op->>'id'), v_op->>'id')::uuid;
        v_expected := (v_op->>'expected_updated_at')::timestamptz;
        IF v_expected IS NULL THEN
          RAISE EXCEPTION 'delete from % needs expected_updated_at', v_table USING HINT = 'stale';
        END IF;
        IF v_table = 'inventory_items' AND EXISTS (
          SELECT 1 FROM inventory_movements WHERE item_id = v_id AND farm_id = p_farm_id
        ) THEN
          RAISE EXCEPTION 'inventory items with movement history cannot be deleted' USING HINT = 'linked';
        END IF;
        v_new_id := NULL;
        EXECUTE format(
          'DELETE FROM public.%I AS t WHERE t.id = $1 AND t.farm_id = $2 AND t.updated_at = $3 %s RETURNING t.id',
          v_table,
          CASE WHEN v_table = 'financial_transactions' THEN 'AND t.inventory_movement_id IS NULL' ELSE '' END
        ) INTO v_new_id USING v_id, p_farm_id, v_expected;
        IF v_new_id IS NULL THEN
          RAISE EXCEPTION '% % changed since the proposal', v_table, v_id USING HINT = 'stale';
        END IF;
        v_result := v_result || jsonb_build_object('id', v_new_id);

      ELSIF v_kind = 'move' THEN
        SELECT * INTO v_move FROM public.move_cattle(
          p_farm_id,
          (v_op->>'source_id')::uuid,
          COALESCE(v_placeholders->>(v_op->>'destination_section_id'), v_op->>'destination_section_id')::uuid,
          (v_op->>'move_count')::integer,
          v_op->>'idempotency_key'
        );
        v_result := v_result || jsonb_build_object(
          'table', 'cattle', 'id', v_move.source_id, 'destination_id', v_move.destination_id,
          'move_mode', v_move.move_mode, 'moved_count', v_move.moved_count
        );

      ELSIF v_kind = 'weight' THEN
        v_new_id := public.record_weight(
          p_farm_id,
          (v_op->>'cattle_id')::uuid,
          (v_op->>'date')::date,
          (v_op->>'weight_kg')::numeric,
          v_op->>'notes',
          NULL
        );
        v_result := v_result || jsonb_build_object('table', 'weight_records', 'id', v_new_id);

      ELSIF v_kind = 'purchase' THEN
        v_new_id := public.record_inventory_purchase(
          p_farm_id,
          (v_op->>'item_id')::uuid,
          (v_op->>'quantity')::numeric,
          (v_op->>'unit_cost')::numeric,
          COALESCE(v_placeholders->>(v_op->>'section_id'), v_op->>'section_id')::uuid,
          (v_op->>'crop_id')::uuid,
          (v_op->>'cattle_id')::uuid,
          (v_op->>'date')::date,
          v_op->>'notes',
          COALESCE(v_op->>'currency', 'USD'),
          NULL
        );
        v_result := v_result || jsonb_build_object('table', 'inventory_movements', 'id', v_new_id);

      ELSE
        RAISE EXCEPTION 'unknown operation kind %', v_kind USING HINT = 'invalid';
      END IF;

      v_results := v_results || jsonb_build_array(v_result);
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    -- Re-raise with the failing op's index. Everything above is rolled back
    -- with the whole call; nothing is ever half applied.
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT, v_hint = PG_EXCEPTION_HINT;
    RAISE EXCEPTION USING
      ERRCODE = v_state,
      MESSAGE = v_message,
      DETAIL = jsonb_build_object('op_index', v_index)::text,
      HINT = COALESCE(NULLIF(v_hint, ''), CASE v_state WHEN '40P01' THEN 'deadlock' WHEN '23503' THEN 'relation' ELSE 'failed' END);
  END;

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO ai_operation_batches (farm_id, idempotency_key, results)
      VALUES (p_farm_id, p_idempotency_key, v_results);
  END IF;

  RETURN jsonb_build_object('replayed', false, 'results', v_results);
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_ai_operations(UUID, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_ai_operations(UUID, JSONB, TEXT) TO service_role;

-- Retry keys only matter for the chat request's retry window; keep them as
-- long as chat_requests (040), and keep 044's rule for confirmed proposals.
CREATE OR REPLACE FUNCTION public.purge_operational_retention_rows()
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM whatsapp_events WHERE updated_at < now() - interval '30 days';
  DELETE FROM chat_requests WHERE updated_at < now() - interval '30 days';
  DELETE FROM ai_confirmed_requests WHERE confirmed_at < now() - interval '1 day';
  DELETE FROM ai_operation_batches WHERE created_at < now() - interval '30 days';
END;
$function$;
