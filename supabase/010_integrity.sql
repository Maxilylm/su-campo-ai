-- CampoAI integrity hardening.
-- Apply after 009_weight_records.sql. These functions keep related writes in
-- one Postgres transaction; the API has a compatibility fallback for older
-- databases until this migration is applied.

CREATE UNIQUE INDEX IF NOT EXISTS idx_farms_user_unique
  ON farms(user_id)
  WHERE user_id IS NOT NULL;

ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD';

CREATE OR REPLACE FUNCTION public.record_inventory_purchase(
  p_farm_id UUID,
  p_item_id UUID,
  p_quantity NUMERIC,
  p_unit_cost NUMERIC,
  p_section_id UUID DEFAULT NULL,
  p_crop_id UUID DEFAULT NULL,
  p_cattle_id UUID DEFAULT NULL,
  p_date DATE DEFAULT CURRENT_DATE,
  p_notes TEXT DEFAULT NULL,
  p_currency TEXT DEFAULT 'USD'
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
    section_id, crop_id, cattle_id, date, notes
  ) VALUES (
    p_farm_id, p_item_id, 'compra', p_quantity, p_unit_cost, p_currency,
    p_section_id, p_crop_id, p_cattle_id, p_date, p_notes
  ) RETURNING id INTO v_movement_id;

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

CREATE OR REPLACE FUNCTION public.record_weight(
  p_farm_id UUID,
  p_cattle_id UUID,
  p_date DATE,
  p_weight_kg NUMERIC,
  p_notes TEXT DEFAULT NULL
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

  INSERT INTO weight_records (farm_id, cattle_id, date, weight_kg, notes)
  VALUES (p_farm_id, p_cattle_id, p_date, p_weight_kg, p_notes)
  RETURNING id INTO v_record_id;

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

REVOKE ALL ON FUNCTION public.record_inventory_purchase(UUID, UUID, NUMERIC, NUMERIC, UUID, UUID, UUID, DATE, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_weight(UUID, UUID, DATE, NUMERIC, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_inventory_purchase(UUID, UUID, NUMERIC, NUMERIC, UUID, UUID, UUID, DATE, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_weight(UUID, UUID, DATE, NUMERIC, TEXT) TO service_role;
