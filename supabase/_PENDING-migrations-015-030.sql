-- CampoAI: pending migrations 015-030 combined in numeric (dependency) order.
-- Safe to re-run: idempotent statements throughout, plus DROP POLICY IF EXISTS
-- guards injected before each bare CREATE POLICY.
-- After running, verify: https://89campoai.vercel.app/api/status should report
-- schema.reason = "ok" with no missingMigrations.

-- =========== 015_financial_inventory_links.sql ===========
-- CampoAI financial/inventory link integrity.
-- Resolve any existing duplicate links before applying this migration.

CREATE UNIQUE INDEX IF NOT EXISTS idx_financial_inventory_movement_unique
  ON financial_transactions(inventory_movement_id)
  WHERE inventory_movement_id IS NOT NULL;

-- =========== 016_cattle_ear_tags.sql ===========
-- CampoAI cattle identity integrity.
-- Resolve any existing duplicate caravanas before applying this migration.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM cattle
    WHERE ear_tag IS NOT NULL AND trim(ear_tag) <> ''
    GROUP BY farm_id, lower(trim(ear_tag))
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate cattle ear tags exist; resolve them before applying 016_cattle_ear_tags.sql';
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cattle_farm_ear_tag_unique
  ON cattle(farm_id, lower(trim(ear_tag)))
  WHERE ear_tag IS NOT NULL AND trim(ear_tag) <> '';

-- =========== 017_idempotency.sql ===========
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

-- =========== 018_padron_transaction.sql ===========
-- CampoAI atomic padron setup.
-- Apply after 017_idempotency.sql. A padron and its initial section must be
-- created in one transaction so a partial map setup cannot be persisted.

CREATE OR REPLACE FUNCTION public.create_padron_with_section(
  p_farm_id UUID,
  p_padron_code TEXT,
  p_padron_number INTEGER,
  p_department_code TEXT DEFAULT NULL,
  p_department_name TEXT DEFAULT NULL,
  p_area_m2 NUMERIC DEFAULT NULL,
  p_geometry JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_padron padrones%ROWTYPE;
  v_section sections%ROWTYPE;
BEGIN
  IF p_padron_code IS NULL OR p_padron_code = '' THEN
    RAISE EXCEPTION 'padron code is required';
  END IF;
  IF p_padron_number IS NULL OR p_padron_number < 0 THEN
    RAISE EXCEPTION 'padron number must be non-negative';
  END IF;
  IF p_area_m2 IS NOT NULL AND p_area_m2 <= 0 THEN
    RAISE EXCEPTION 'padron area must be positive';
  END IF;
  IF p_geometry IS NULL OR p_geometry->>'type' IS NULL OR NOT (p_geometry ? 'coordinates') THEN
    RAISE EXCEPTION 'padron geometry is invalid';
  END IF;

  INSERT INTO padrones (
    farm_id, padron_code, padron_number, department_code,
    department_name, area_m2, geometry
  ) VALUES (
    p_farm_id, p_padron_code, p_padron_number, p_department_code,
    p_department_name, p_area_m2, p_geometry
  )
  RETURNING * INTO v_padron;

  INSERT INTO sections (
    farm_id, padron_id, name, size_hectares, color,
    water_status, pasture_status
  ) VALUES (
    p_farm_id,
    v_padron.id,
    p_padron_code,
    CASE WHEN p_area_m2 IS NULL THEN NULL ELSE round((p_area_m2 / 10000.0)::numeric, 1) END,
    '#22c55e',
    'bueno',
    'bueno'
  )
  RETURNING * INTO v_section;

  RETURN jsonb_build_object(
    'padron', to_jsonb(v_padron),
    'section', to_jsonb(v_section)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_padron_with_section(UUID, TEXT, INTEGER, TEXT, TEXT, NUMERIC, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_padron_with_section(UUID, TEXT, INTEGER, TEXT, TEXT, NUMERIC, JSONB) TO service_role;

-- =========== 019_padron_idempotency.sql ===========
-- CampoAI padron retry safety.
-- Apply after 018_padron_transaction.sql. A lost response must not create a
-- second padron and section when the same map action is submitted again.

ALTER TABLE padrones
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_padrones_idempotency
  ON padrones(farm_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

DROP FUNCTION IF EXISTS public.create_padron_with_section(UUID, TEXT, INTEGER, TEXT, TEXT, NUMERIC, JSONB);

CREATE FUNCTION public.create_padron_with_section(
  p_farm_id UUID,
  p_padron_code TEXT,
  p_padron_number INTEGER,
  p_department_code TEXT DEFAULT NULL,
  p_department_name TEXT DEFAULT NULL,
  p_area_m2 NUMERIC DEFAULT NULL,
  p_geometry JSONB DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_padron padrones%ROWTYPE;
  v_section sections%ROWTYPE;
BEGIN
  IF p_padron_code IS NULL OR p_padron_code = '' THEN
    RAISE EXCEPTION 'padron code is required';
  END IF;
  IF p_padron_number IS NULL OR p_padron_number < 0 THEN
    RAISE EXCEPTION 'padron number must be non-negative';
  END IF;
  IF p_area_m2 IS NOT NULL AND p_area_m2 <= 0 THEN
    RAISE EXCEPTION 'padron area must be positive';
  END IF;
  IF p_geometry IS NULL OR p_geometry->>'type' IS NULL OR NOT (p_geometry ? 'coordinates') THEN
    RAISE EXCEPTION 'padron geometry is invalid';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_padron
    FROM padrones
    WHERE farm_id = p_farm_id AND idempotency_key = p_idempotency_key;
    IF FOUND THEN
      SELECT * INTO v_section
      FROM sections
      WHERE farm_id = p_farm_id AND padron_id = v_padron.id
      ORDER BY created_at
      LIMIT 1;
      IF FOUND THEN
        RETURN jsonb_build_object('padron', to_jsonb(v_padron), 'section', to_jsonb(v_section));
      END IF;
      RAISE EXCEPTION 'idempotent padron has no section';
    END IF;
  END IF;

  INSERT INTO padrones (
    farm_id, padron_code, padron_number, department_code,
    department_name, area_m2, geometry, idempotency_key
  ) VALUES (
    p_farm_id, p_padron_code, p_padron_number, p_department_code,
    p_department_name, p_area_m2, p_geometry, p_idempotency_key
  )
  ON CONFLICT (farm_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
  RETURNING * INTO v_padron;

  IF v_padron.id IS NULL AND p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_padron
    FROM padrones
    WHERE farm_id = p_farm_id AND idempotency_key = p_idempotency_key;
    IF NOT FOUND THEN RAISE EXCEPTION 'idempotent padron could not be resolved'; END IF;
    SELECT * INTO v_section
    FROM sections
    WHERE farm_id = p_farm_id AND padron_id = v_padron.id
    ORDER BY created_at
    LIMIT 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'idempotent padron has no section'; END IF;
    RETURN jsonb_build_object('padron', to_jsonb(v_padron), 'section', to_jsonb(v_section));
  END IF;

  INSERT INTO sections (
    farm_id, padron_id, name, size_hectares, color,
    water_status, pasture_status
  ) VALUES (
    p_farm_id,
    v_padron.id,
    p_padron_code,
    CASE WHEN p_area_m2 IS NULL THEN NULL ELSE round((p_area_m2 / 10000.0)::numeric, 1) END,
    '#22c55e',
    'bueno',
    'bueno'
  )
  RETURNING * INTO v_section;

  RETURN jsonb_build_object(
    'padron', to_jsonb(v_padron),
    'section', to_jsonb(v_section)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_padron_with_section(UUID, TEXT, INTEGER, TEXT, TEXT, NUMERIC, JSONB, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_padron_with_section(UUID, TEXT, INTEGER, TEXT, TEXT, NUMERIC, JSONB, TEXT) TO service_role;

-- =========== 020_import_idempotency.sql ===========
-- CampoAI bulk import retry safety.
-- Apply after 019_padron_idempotency.sql. A CSV request keeps the same key and
-- row index across retries, so losing the response cannot duplicate a batch.

ALTER TABLE cattle
  ADD COLUMN IF NOT EXISTS import_batch_key TEXT,
  ADD COLUMN IF NOT EXISTS import_row_index INTEGER;

ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS import_batch_key TEXT,
  ADD COLUMN IF NOT EXISTS import_row_index INTEGER;

ALTER TABLE financial_transactions
  ADD COLUMN IF NOT EXISTS import_batch_key TEXT,
  ADD COLUMN IF NOT EXISTS import_row_index INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cattle_import_batch_rows
  ON cattle(farm_id, import_batch_key, import_row_index)
  WHERE import_batch_key IS NOT NULL AND import_row_index IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_import_batch_rows
  ON inventory_items(farm_id, import_batch_key, import_row_index)
  WHERE import_batch_key IS NOT NULL AND import_row_index IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_financial_import_batch_rows
  ON financial_transactions(farm_id, import_batch_key, import_row_index)
  WHERE import_batch_key IS NOT NULL AND import_row_index IS NOT NULL;

-- =========== 021_cattle_move_transaction.sql ===========
-- CampoAI atomic cattle moves.
-- Apply after 020_import_idempotency.sql. A partial move must reduce the
-- source batch and create its destination batch in the same transaction.

CREATE OR REPLACE FUNCTION public.move_cattle(
  p_farm_id UUID,
  p_source_cattle_id UUID,
  p_destination_section_id UUID,
  p_move_count INTEGER
)
RETURNS TABLE (
  source_id UUID,
  destination_id UUID,
  moved_count INTEGER,
  move_mode TEXT
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_source cattle%ROWTYPE;
  v_destination_id UUID;
BEGIN
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
    RETURN QUERY SELECT v_source.id, NULL::UUID, 0, 'noop'::TEXT;
    RETURN;
  END IF;

  IF p_move_count >= v_source.count THEN
    UPDATE cattle
    SET section_id = p_destination_section_id,
        updated_at = now()
    WHERE id = v_source.id AND farm_id = p_farm_id;

    RETURN QUERY SELECT v_source.id, NULL::UUID, v_source.count, 'all'::TEXT;
    RETURN;
  END IF;

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

  RETURN QUERY SELECT v_source.id, v_destination_id, p_move_count, 'split'::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.move_cattle(UUID, UUID, UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.move_cattle(UUID, UUID, UUID, INTEGER) TO service_role;

-- =========== 022_task_idempotency.sql ===========
-- CampoAI task retry safety.
-- Apply after 021_cattle_move_transaction.sql. A lost response must not create
-- a duplicate task when the operator submits the same draft again.

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_idempotency
  ON tasks(farm_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- =========== 023_financial_idempotency.sql ===========
-- CampoAI financial retry safety.
-- Apply after 022_task_idempotency.sql. A lost response must not create a
-- duplicate income or expense when the same form is submitted again.

ALTER TABLE financial_transactions
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_financial_transactions_idempotency
  ON financial_transactions(farm_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- =========== 024_operational_idempotency.sql ===========
-- CampoAI operational retry safety.
-- Apply after 023_financial_idempotency.sql. A lost response must not create
-- duplicate agriculture or animal-health records when the operator retries.

ALTER TABLE crops
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

ALTER TABLE crop_applications
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

ALTER TABLE vaccinations
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

ALTER TABLE health_events
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_crops_idempotency
  ON crops(farm_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_crop_applications_idempotency
  ON crop_applications(farm_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_vaccinations_idempotency
  ON vaccinations(farm_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_health_events_idempotency
  ON health_events(farm_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- =========== 025_map_feature_idempotency.sql ===========
-- CampoAI map feature retry safety.
-- Apply after 024_operational_idempotency.sql. A lost response must not create
-- duplicate roads, gates, ponds or other drawn infrastructure on retry.

ALTER TABLE map_features
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_map_features_idempotency
  ON map_features(farm_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- =========== 026_chat_request_idempotency.sql ===========
-- CampoAI chat retry safety.
-- Keep a request claim and its final response separate from chat history so a
-- lost HTTP response cannot cause the AI's database operations to run twice.

CREATE TABLE IF NOT EXISTS chat_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'side_effects_done', 'completed', 'failed')),
  response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (farm_id, request_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_requests_updated
  ON chat_requests(farm_id, updated_at DESC);

ALTER TABLE chat_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access" ON chat_requests;
CREATE POLICY "Service role full access" ON chat_requests FOR ALL
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Users manage own chat requests" ON chat_requests;
CREATE POLICY "Users manage own chat requests" ON chat_requests FOR ALL
  USING (farm_id IN (SELECT id FROM farms WHERE user_id = auth.uid()));

-- =========== 027_whatsapp_side_effects.sql ===========
-- CampoAI WhatsApp retry safety.
-- Once AI database operations have run, retain the outbound response so a
-- provider retry can resend it without running those operations twice.

ALTER TABLE whatsapp_events
  ADD COLUMN IF NOT EXISTS response_text TEXT;

-- =========== 028_sample_data_idempotency.sql ===========
-- CampoAI sample-data retry safety.
-- A slow response or a double click must not seed the same farm twice.

CREATE TABLE IF NOT EXISTS sample_data_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'completed', 'failed')),
  response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, request_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sample_data_active_user
  ON sample_data_requests(user_id)
  WHERE status = 'processing';

CREATE INDEX IF NOT EXISTS idx_sample_data_requests_updated
  ON sample_data_requests(user_id, updated_at DESC);

ALTER TABLE sample_data_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access" ON sample_data_requests;
CREATE POLICY "Service role full access" ON sample_data_requests FOR ALL
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Users manage own sample data requests" ON sample_data_requests;
CREATE POLICY "Users manage own sample data requests" ON sample_data_requests FOR ALL
  USING (user_id = auth.uid());

-- =========== 029_hacienda_idempotency.sql ===========
-- CampoAI retry safety for the core livestock forms.
-- A lost response must not create duplicate sections or cattle batches when
-- the operator submits the same form again.

ALTER TABLE sections
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

ALTER TABLE cattle
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sections_idempotency
  ON sections(farm_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cattle_idempotency
  ON cattle(farm_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- =========== 030_inventory_item_idempotency.sql ===========
-- CampoAI retry safety for inventory item creation.
-- A lost response must not create duplicate supplies when the operator retries.

ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_items_idempotency
  ON inventory_items(farm_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

