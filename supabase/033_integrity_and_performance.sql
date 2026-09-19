-- CampoAI: data-integrity CHECK constraints, inventory trigger correctness,
-- farms.user_id delete behavior, missing FK indexes, composite hot-path
-- indexes, and a real idempotency key for move_cattle.
--
-- All CHECK constraints below were verified against zero existing violations
-- (cattle.count < 0, inventory_items.current_stock < 0,
-- financial_transactions.amount < 0 all returned 0 rows; currency columns
-- only ever contain 'USD' today) before writing this migration.

-- ── 1. Non-negative / enum CHECK constraints ──────────────────────
ALTER TABLE public.cattle
  ADD CONSTRAINT cattle_count_nonneg CHECK (count >= 0);

ALTER TABLE public.inventory_items
  ADD CONSTRAINT inventory_items_current_stock_nonneg CHECK (current_stock >= 0);

ALTER TABLE public.financial_transactions
  ADD CONSTRAINT financial_transactions_amount_nonneg CHECK (amount >= 0);

ALTER TABLE public.financial_transactions
  ADD CONSTRAINT financial_transactions_currency_enum CHECK (currency IN ('USD', 'UYU', 'ARS'));

ALTER TABLE public.inventory_items
  ADD CONSTRAINT inventory_items_currency_enum CHECK (currency IN ('USD', 'UYU', 'ARS'));

-- ── 2. update_inventory_stock: handle UPDATE/DELETE, not just INSERT ──
-- Today only INSERT is handled: no app code currently updates or deletes an
-- inventory_movements row, but the trigger silently drifting stock on any
-- future/manual UPDATE or DELETE is exactly the kind of bug that's invisible
-- until it corrupts data. search_path was already fixed in 032.
CREATE OR REPLACE FUNCTION public.update_inventory_stock()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE inventory_items
    SET current_stock = current_stock + NEW.quantity
    WHERE id = NEW.item_id;

    IF NEW.type = 'compra' AND NEW.unit_cost IS NOT NULL THEN
      UPDATE inventory_items
      SET cost_per_unit = NEW.unit_cost,
          currency = COALESCE(NULLIF(NEW.currency, ''), currency)
      WHERE id = NEW.item_id;
    END IF;
    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    -- Reverse the old movement's effect, then apply the new one. Handles an
    -- item_id change too (reverses on the old item, applies on the new one).
    UPDATE inventory_items
    SET current_stock = current_stock - OLD.quantity
    WHERE id = OLD.item_id;

    UPDATE inventory_items
    SET current_stock = current_stock + NEW.quantity
    WHERE id = NEW.item_id;

    IF NEW.type = 'compra' AND NEW.unit_cost IS NOT NULL THEN
      UPDATE inventory_items
      SET cost_per_unit = NEW.unit_cost,
          currency = COALESCE(NULLIF(NEW.currency, ''), currency)
      WHERE id = NEW.item_id;
    END IF;
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    UPDATE inventory_items
    SET current_stock = current_stock - OLD.quantity
    WHERE id = OLD.item_id;
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_inventory_stock_update ON public.inventory_movements;
CREATE TRIGGER trg_inventory_stock_update
  AFTER INSERT OR UPDATE OR DELETE ON public.inventory_movements
  FOR EACH ROW EXECUTE FUNCTION public.update_inventory_stock();

-- ── 3. farms.user_id: ON DELETE SET NULL ──────────────────────────
-- Today deleting an auth.users row referenced by farms.user_id fails outright
-- (default NO ACTION). The column is already nullable and farm_members now
-- carries real access, so orphaning the legacy owner pointer is safe.
ALTER TABLE public.farms DROP CONSTRAINT farms_user_id_fkey;
ALTER TABLE public.farms
  ADD CONSTRAINT farms_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- ── 4. Missing FK indexes (15, from the performance advisor) ──────
CREATE INDEX IF NOT EXISTS idx_crops_section_id ON public.crops(section_id);
CREATE INDEX IF NOT EXISTS idx_farm_invites_accepted_by ON public.farm_invites(accepted_by);
CREATE INDEX IF NOT EXISTS idx_farm_invites_invited_by ON public.farm_invites(invited_by);
CREATE INDEX IF NOT EXISTS idx_financial_transactions_cattle_id ON public.financial_transactions(cattle_id);
CREATE INDEX IF NOT EXISTS idx_financial_transactions_crop_id ON public.financial_transactions(crop_id);
CREATE INDEX IF NOT EXISTS idx_financial_transactions_inventory_movement_id ON public.financial_transactions(inventory_movement_id);
CREATE INDEX IF NOT EXISTS idx_financial_transactions_section_id ON public.financial_transactions(section_id);
CREATE INDEX IF NOT EXISTS idx_health_events_cattle_id ON public.health_events(cattle_id);
CREATE INDEX IF NOT EXISTS idx_health_events_section_id ON public.health_events(section_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_cattle_id ON public.inventory_movements(cattle_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_crop_id ON public.inventory_movements(crop_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_section_id ON public.inventory_movements(section_id);
CREATE INDEX IF NOT EXISTS idx_sections_padron_id ON public.sections(padron_id);
CREATE INDEX IF NOT EXISTS idx_vaccinations_cattle_id ON public.vaccinations(cattle_id);
CREATE INDEX IF NOT EXISTS idx_vaccinations_section_id ON public.vaccinations(section_id);

-- ── 5. Composite hot-path indexes ─────────────────────────────────
-- Every real query on these tables filters by farm_id AND orders by
-- created_at desc; the single-column created_at indexes were confirmed
-- unused by the performance advisor and are superseded by the composite.
CREATE INDEX IF NOT EXISTS idx_activities_farm_created ON public.activities(farm_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_farm_created ON public.chat_messages(farm_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crop_applications_farm ON public.crop_applications(farm_id);
DROP INDEX IF EXISTS public.idx_activities_created;
DROP INDEX IF EXISTS public.idx_chat_messages_created;

-- ── 6. move_cattle idempotency ────────────────────────────────────
-- A client retry (timeout, dropped response) of the same AI move operation
-- previously re-ran the split logic and split the batch a second time.
CREATE TABLE IF NOT EXISTS public.cattle_move_idempotency (
  farm_id UUID NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (farm_id, idempotency_key)
);

ALTER TABLE public.cattle_move_idempotency ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access" ON public.cattle_move_idempotency;
CREATE POLICY "Service role full access" ON public.cattle_move_idempotency
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.move_cattle(
  p_farm_id UUID,
  p_source_cattle_id UUID,
  p_destination_section_id UUID,
  p_move_count INTEGER,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS TABLE(source_id UUID, destination_id UUID, moved_count INTEGER, move_mode TEXT)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_source cattle%ROWTYPE;
  v_destination_id UUID;
  v_moved_count INTEGER;
  v_move_mode TEXT;
  v_cached RECORD;
BEGIN
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_cached FROM cattle_move_idempotency
    WHERE farm_id = p_farm_id AND idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN QUERY SELECT
        (v_cached.result->>'source_id')::UUID,
        NULLIF(v_cached.result->>'destination_id', '')::UUID,
        (v_cached.result->>'moved_count')::INTEGER,
        v_cached.result->>'move_mode';
      RETURN;
    END IF;
  END IF;

  IF p_move_count IS NULL OR p_move_count <= 0 THEN
    RAISE EXCEPTION 'move count must be positive';
  END IF;

  SELECT * INTO v_source
  FROM cattle
  WHERE id = p_source_cattle_id AND farm_id = p_farm_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'source cattle batch not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM sections
    WHERE id = p_destination_section_id AND farm_id = p_farm_id
  ) THEN
    RAISE EXCEPTION 'destination section does not belong to farm';
  END IF;

  IF v_source.section_id = p_destination_section_id THEN
    v_destination_id := NULL;
    v_moved_count := 0;
    v_move_mode := 'noop';
  ELSIF p_move_count >= v_source.count THEN
    UPDATE cattle
    SET section_id = p_destination_section_id,
        updated_at = now()
    WHERE id = v_source.id AND farm_id = p_farm_id;

    v_destination_id := NULL;
    v_moved_count := v_source.count;
    v_move_mode := 'all';
  ELSE
    UPDATE cattle
    SET count = v_source.count - p_move_count,
        updated_at = now()
    WHERE id = v_source.id AND farm_id = p_farm_id;

    INSERT INTO cattle (
      farm_id, section_id, category, breed, count, tag_range,
      health_status, notes, weight_kg, birth_date, origin,
      vaccination_status, last_vaccinated, reproductive_status, ear_tag
    ) VALUES (
      p_farm_id, p_destination_section_id, v_source.category, v_source.breed,
      p_move_count, v_source.tag_range, v_source.health_status, NULL,
      v_source.weight_kg, v_source.birth_date, v_source.origin,
      v_source.vaccination_status, v_source.last_vaccinated,
      v_source.reproductive_status, NULL
    )
    RETURNING id INTO v_destination_id;

    v_moved_count := p_move_count;
    v_move_mode := 'split';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO cattle_move_idempotency (farm_id, idempotency_key, result)
    VALUES (
      p_farm_id, p_idempotency_key,
      jsonb_build_object(
        'source_id', v_source.id,
        'destination_id', v_destination_id,
        'moved_count', v_moved_count,
        'move_mode', v_move_mode
      )
    )
    ON CONFLICT (farm_id, idempotency_key) DO NOTHING;
  END IF;

  RETURN QUERY SELECT v_source.id, v_destination_id, v_moved_count, v_move_mode;
END;
$function$;
