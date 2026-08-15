-- CampoAI mutation idempotency.
-- Apply after 016_cattle_ear_tags.sql. A retry key makes critical weighing
-- and inventory requests safe when the client loses the response after commit.

ALTER TABLE inventory_movements
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

ALTER TABLE weight_records
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_movements_idempotency
  ON inventory_movements(farm_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_weight_records_idempotency
  ON weight_records(farm_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

DROP FUNCTION IF EXISTS public.record_inventory_purchase(UUID, UUID, NUMERIC, NUMERIC, UUID, UUID, UUID, DATE, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.record_inventory_purchase(UUID, UUID, NUMERIC, NUMERIC, UUID, UUID, UUID, DATE, TEXT, TEXT, TEXT);

CREATE FUNCTION public.record_inventory_purchase(
  p_farm_id UUID,
  p_item_id UUID,
  p_quantity NUMERIC,
  p_unit_cost NUMERIC,
  p_section_id UUID DEFAULT NULL,
  p_crop_id UUID DEFAULT NULL,
  p_cattle_id UUID DEFAULT NULL,
  p_date DATE DEFAULT CURRENT_DATE,
  p_notes TEXT DEFAULT NULL,
  p_currency TEXT DEFAULT 'USD',
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_item inventory_items%ROWTYPE;
  v_movement_id UUID;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'purchase quantity must be positive';
  END IF;
  IF p_unit_cost IS NULL OR p_unit_cost < 0 THEN
    RAISE EXCEPTION 'unit cost must be non-negative';
  END IF;
  IF p_currency NOT IN ('USD', 'UYU', 'ARS') THEN
    RAISE EXCEPTION 'unsupported currency';
  END IF;

  SELECT * INTO v_item
  FROM inventory_items
  WHERE id = p_item_id AND farm_id = p_farm_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'inventory item not found'; END IF;

  IF p_section_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sections WHERE id = p_section_id AND farm_id = p_farm_id) THEN
    RAISE EXCEPTION 'section does not belong to farm';
  END IF;
  IF p_crop_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM crops WHERE id = p_crop_id AND farm_id = p_farm_id) THEN
    RAISE EXCEPTION 'crop does not belong to farm';
  END IF;
  IF p_cattle_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM cattle WHERE id = p_cattle_id AND farm_id = p_farm_id) THEN
    RAISE EXCEPTION 'cattle does not belong to farm';
  END IF;

  INSERT INTO inventory_movements (
    farm_id, item_id, type, quantity, unit_cost, currency,
    section_id, crop_id, cattle_id, date, notes, idempotency_key
  ) VALUES (
    p_farm_id, p_item_id, 'compra', p_quantity, p_unit_cost, p_currency,
    p_section_id, p_crop_id, p_cattle_id, p_date, p_notes, p_idempotency_key
  )
  ON CONFLICT (farm_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
  RETURNING id INTO v_movement_id;

  IF v_movement_id IS NULL AND p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_movement_id
    FROM inventory_movements
    WHERE farm_id = p_farm_id AND idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_movement_id; END IF;
    RAISE EXCEPTION 'idempotent purchase could not be resolved';
  END IF;

  INSERT INTO financial_transactions (
    farm_id, type, category, description, amount, currency, date,
    section_id, crop_id, cattle_id, inventory_movement_id, notes
  ) VALUES (
    p_farm_id, 'egreso', 'compra_insumo', 'Compra: ' || v_item.name,
    p_quantity * p_unit_cost, p_currency, p_date,
    p_section_id, p_crop_id, p_cattle_id, v_movement_id, p_notes
  );

  RETURN v_movement_id;
END;
$$;

CREATE FUNCTION public.record_weight(
  p_farm_id UUID,
  p_cattle_id UUID,
  p_date DATE,
  p_weight_kg NUMERIC,
  p_notes TEXT DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_record_id UUID;
BEGIN
  IF p_weight_kg IS NULL OR p_weight_kg <= 0 THEN
    RAISE EXCEPTION 'weight must be positive';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cattle WHERE id = p_cattle_id AND farm_id = p_farm_id) THEN
    RAISE EXCEPTION 'cattle batch not found';
  END IF;

  INSERT INTO weight_records (farm_id, cattle_id, date, weight_kg, notes, idempotency_key)
  VALUES (p_farm_id, p_cattle_id, p_date, p_weight_kg, p_notes, p_idempotency_key)
  ON CONFLICT (farm_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
  RETURNING id INTO v_record_id;

  IF v_record_id IS NULL AND p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_record_id
    FROM weight_records
    WHERE farm_id = p_farm_id AND idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_record_id; END IF;
    RAISE EXCEPTION 'idempotent weight could not be resolved';
  END IF;

  UPDATE cattle
  SET weight_kg = (
    SELECT weight_kg FROM weight_records
    WHERE cattle_id = p_cattle_id AND farm_id = p_farm_id
    ORDER BY date DESC, created_at DESC
    LIMIT 1
  ), updated_at = now()
  WHERE id = p_cattle_id AND farm_id = p_farm_id;

  RETURN v_record_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_inventory_purchase(UUID, UUID, NUMERIC, NUMERIC, UUID, UUID, UUID, DATE, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_weight(UUID, UUID, DATE, NUMERIC, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_inventory_purchase(UUID, UUID, NUMERIC, NUMERIC, UUID, UUID, UUID, DATE, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_weight(UUID, UUID, DATE, NUMERIC, TEXT, TEXT) TO service_role;
