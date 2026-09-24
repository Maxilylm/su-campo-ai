-- Proof for 051_apply_ai_operations.sql. Safe to run against production:
-- it creates two throwaway farms inside one DO block and ends with
-- RAISE EXCEPTION 'ROLLBACK_OK', so every row it writes is rolled back.
-- Expected outcome: the statement fails with exactly "ROLLBACK_OK".
-- Any other error is a failed assertion (its message says which).
DO $$
DECLARE
  v_farm UUID;
  v_other_farm UUID;
  v_a UUID;
  v_b UUID;
  v_foreign_section UUID;
  v_cattle UUID;
  v_a_stamp TIMESTAMPTZ;
  v_b_stamp TIMESTAMPTZ;
  v_result JSONB;
  v_replay JSONB;
  v_new_section UUID;
  v_state TEXT;
  v_message TEXT;
  v_detail TEXT;
  v_hint TEXT;
  v_count INTEGER;
BEGIN
  -- Grants: only service_role may call it.
  IF has_function_privilege('anon', 'public.apply_ai_operations(uuid, jsonb, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.apply_ai_operations(uuid, jsonb, text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.apply_ai_operations(uuid, jsonb, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'grants: EXECUTE must be service_role only';
  END IF;

  INSERT INTO farms (name, owner_phone) VALUES ('ROLLBACK TEST 051', 'rollback-test-051-' || gen_random_uuid()) RETURNING id INTO v_farm;
  INSERT INTO farms (name, owner_phone) VALUES ('ROLLBACK TEST 051 other', 'rollback-test-051-' || gen_random_uuid()) RETURNING id INTO v_other_farm;
  INSERT INTO sections (farm_id, name) VALUES (v_farm, 'Test A') RETURNING id, updated_at INTO v_a, v_a_stamp;
  INSERT INTO sections (farm_id, name) VALUES (v_farm, 'Test B') RETURNING id, updated_at INTO v_b, v_b_stamp;
  INSERT INTO sections (farm_id, name) VALUES (v_other_farm, 'Ajena') RETURNING id INTO v_foreign_section;
  INSERT INTO cattle (farm_id, section_id, category, count) VALUES (v_farm, v_a, 'novillo', 10) RETURNING id INTO v_cattle;

  -- ── 1. A successful batch: every kind, and a placeholder used twice. ──
  v_result := public.apply_ai_operations(v_farm, jsonb_build_array(
    jsonb_build_object('kind', 'insert', 'table', 'sections', 'data', jsonb_build_object('name', 'Test Nuevo', 'farm_id', v_other_farm), 'placeholder', 'NEW_SECTION_Test Nuevo'),
    jsonb_build_object('kind', 'move', 'source_id', v_cattle, 'destination_section_id', 'NEW_SECTION_Test Nuevo', 'move_count', 4, 'idempotency_key', 'rollback-test:move:1'),
    jsonb_build_object('kind', 'update', 'table', 'sections', 'id', v_a, 'data', jsonb_build_object('notes', 'actualizado'), 'expected_updated_at', v_a_stamp),
    jsonb_build_object('kind', 'weight', 'cattle_id', v_cattle, 'date', '2026-09-24', 'weight_kg', 380, 'notes', NULL),
    jsonb_build_object('kind', 'insert', 'table', 'tasks', 'data', jsonb_build_object('title', 'Revisar agua', 'priority', 'high', 'section_id', 'NEW_SECTION_Test Nuevo'))
  ), 'rollback-test:batch');

  IF (v_result->>'replayed')::boolean OR jsonb_array_length(v_result->'results') <> 5 THEN
    RAISE EXCEPTION 'success batch: expected 5 fresh results, got %', v_result;
  END IF;
  IF v_result->'results'->1->>'move_mode' <> 'split' OR (v_result->'results'->1->>'moved_count')::int <> 4 THEN
    RAISE EXCEPTION 'success batch: expected a split move of 4, got %', v_result->'results'->1;
  END IF;
  v_new_section := (v_result->'results'->0->>'id')::uuid;
  IF NOT EXISTS (SELECT 1 FROM sections WHERE id = v_new_section AND farm_id = v_farm) THEN
    RAISE EXCEPTION 'success batch: the new section must belong to the batch farm, not the payload farm_id';
  END IF;
  IF (SELECT count FROM cattle WHERE id = v_cattle) <> 6
     OR NOT EXISTS (SELECT 1 FROM cattle WHERE farm_id = v_farm AND section_id = v_new_section AND count = 4) THEN
    RAISE EXCEPTION 'success batch: the move did not split 10 into 6 + 4 in the new section';
  END IF;
  IF (SELECT notes FROM sections WHERE id = v_a) IS DISTINCT FROM 'actualizado' THEN
    RAISE EXCEPTION 'success batch: the update was not applied';
  END IF;
  IF (SELECT weight_kg FROM cattle WHERE id = v_cattle) <> 380 THEN
    RAISE EXCEPTION 'success batch: record_weight did not sync the batch weight';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM tasks WHERE farm_id = v_farm AND section_id = v_new_section AND title = 'Revisar agua') THEN
    RAISE EXCEPTION 'success batch: the task did not get the placeholder section id';
  END IF;

  -- ── 2. The same key again replays the stored result and writes nothing. ──
  SELECT count(*) INTO v_count FROM sections WHERE farm_id = v_farm;
  v_replay := public.apply_ai_operations(v_farm, jsonb_build_array(
    jsonb_build_object('kind', 'insert', 'table', 'sections', 'data', jsonb_build_object('name', 'Test Nuevo'), 'placeholder', 'NEW_SECTION_Test Nuevo')
  ), 'rollback-test:batch');
  IF NOT (v_replay->>'replayed')::boolean OR v_replay->'results' <> v_result->'results' THEN
    RAISE EXCEPTION 'replay: expected the stored result, got %', v_replay;
  END IF;
  IF (SELECT count(*) FROM sections WHERE farm_id = v_farm) <> v_count THEN
    RAISE EXCEPTION 'replay: a retried batch wrote again';
  END IF;

  -- ── 3. Second op fails (stale anchor): the first op must be rolled back. ──
  BEGIN
    PERFORM public.apply_ai_operations(v_farm, jsonb_build_array(
      jsonb_build_object('kind', 'insert', 'table', 'sections', 'data', jsonb_build_object('name', 'Test Fallida')),
      jsonb_build_object('kind', 'update', 'table', 'sections', 'id', v_b, 'data', jsonb_build_object('notes', 'no'), 'expected_updated_at', v_b_stamp - interval '1 second')
    ), 'rollback-test:failed');
    RAISE EXCEPTION 'stale batch: expected an error, got success';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT, v_detail = PG_EXCEPTION_DETAIL, v_hint = PG_EXCEPTION_HINT;
    IF v_message LIKE 'stale batch:%' THEN RAISE; END IF;
    IF v_hint <> 'stale' OR (v_detail::jsonb->>'op_index')::int <> 1 THEN
      RAISE EXCEPTION 'stale batch: expected hint stale at op 1, got % / % / %', v_message, v_detail, v_hint;
    END IF;
  END;
  IF EXISTS (SELECT 1 FROM sections WHERE farm_id = v_farm AND name = 'Test Fallida') THEN
    RAISE EXCEPTION 'stale batch: op 1 was NOT rolled back';
  END IF;
  IF EXISTS (SELECT 1 FROM ai_operation_batches WHERE farm_id = v_farm AND idempotency_key = 'rollback-test:failed') THEN
    RAISE EXCEPTION 'stale batch: a failed batch must not store a replay result';
  END IF;

  -- ── 4. Second op fails inside move_cattle: the first (successful) move
  --       is rolled back with it. ──
  BEGIN
    PERFORM public.apply_ai_operations(v_farm, jsonb_build_array(
      jsonb_build_object('kind', 'move', 'source_id', v_cattle, 'destination_section_id', v_b, 'move_count', 1),
      jsonb_build_object('kind', 'move', 'source_id', gen_random_uuid(), 'destination_section_id', v_b, 'move_count', 1)
    ), NULL);
    RAISE EXCEPTION 'move batch: expected an error, got success';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT, v_detail = PG_EXCEPTION_DETAIL;
    IF v_message LIKE 'move batch:%' THEN RAISE; END IF;
    IF v_message <> 'source cattle batch not found' OR (v_detail::jsonb->>'op_index')::int <> 1 THEN
      RAISE EXCEPTION 'move batch: expected move_cattle''s error at op 1, got % / %', v_message, v_detail;
    END IF;
  END;
  IF (SELECT count FROM cattle WHERE id = v_cattle) <> 6
     OR EXISTS (SELECT 1 FROM cattle WHERE farm_id = v_farm AND section_id = v_b) THEN
    RAISE EXCEPTION 'move batch: the first move was NOT rolled back';
  END IF;

  -- ── 5. A reference to another farm's section is refused. ──
  BEGIN
    PERFORM public.apply_ai_operations(v_farm, jsonb_build_array(
      jsonb_build_object('kind', 'insert', 'table', 'activities', 'data', jsonb_build_object('type', 'note', 'description', 'antes')),
      jsonb_build_object('kind', 'insert', 'table', 'cattle', 'data', jsonb_build_object('category', 'vaca', 'count', 3, 'section_id', v_foreign_section))
    ), NULL);
    RAISE EXCEPTION 'cross-farm batch: expected an error, got success';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT, v_detail = PG_EXCEPTION_DETAIL, v_hint = PG_EXCEPTION_HINT;
    IF v_message LIKE 'cross-farm batch:%' THEN RAISE; END IF;
    IF v_hint <> 'relation' OR (v_detail::jsonb->>'op_index')::int <> 1 THEN
      RAISE EXCEPTION 'cross-farm batch: expected hint relation at op 1, got % / % / %', v_message, v_detail, v_hint;
    END IF;
  END;
  IF EXISTS (SELECT 1 FROM activities WHERE farm_id = v_farm AND description = 'antes')
     OR EXISTS (SELECT 1 FROM cattle WHERE section_id = v_foreign_section) THEN
    RAISE EXCEPTION 'cross-farm batch: something was written';
  END IF;

  -- ── 6. An update can never reach another farm's row. ──
  BEGIN
    PERFORM public.apply_ai_operations(v_other_farm, jsonb_build_array(
      jsonb_build_object('kind', 'update', 'table', 'sections', 'id', v_a, 'data', jsonb_build_object('notes', 'robado'), 'expected_updated_at', (SELECT updated_at FROM sections WHERE id = v_a))
    ), NULL);
    RAISE EXCEPTION 'foreign update: expected an error, got success';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT, v_hint = PG_EXCEPTION_HINT;
    IF v_message LIKE 'foreign update:%' THEN RAISE; END IF;
    IF v_hint <> 'stale' THEN
      RAISE EXCEPTION 'foreign update: expected hint stale (row not found for this farm), got % / %', v_message, v_hint;
    END IF;
  END;
  IF (SELECT notes FROM sections WHERE id = v_a) <> 'actualizado' THEN
    RAISE EXCEPTION 'foreign update: another farm changed this row';
  END IF;

  RAISE EXCEPTION 'ROLLBACK_OK';
END;
$$;
