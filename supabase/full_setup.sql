-- CampoAI — one-shot database setup
-- Generated from the ordered migrations. Run ONCE on a fresh Supabase project
-- (SQL Editor → paste → Run). NOT idempotent: CREATE POLICY has no IF NOT EXISTS,
-- so re-running on an existing DB will error on duplicate policies.
-- Apply order: schema → 002 → 003 → 004 → 005 → 006 → 007 → 008 → 009
-- After the sections below, apply 010_integrity.sql for transaction helpers
-- and the one-farm-per-user uniqueness constraint.


-- ═══════════════════════════════════════════════════════════════
-- schema.sql
-- ═══════════════════════════════════════════════════════════════
-- CampoAI Database Schema
-- Run this in Supabase SQL Editor to set up all tables

-- Farms
CREATE TABLE IF NOT EXISTS farms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  owner_phone TEXT NOT NULL UNIQUE,
  total_hectares NUMERIC,
  location TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Sections (potreros/paddocks)
CREATE TABLE IF NOT EXISTS sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  size_hectares NUMERIC,
  capacity INTEGER,
  description TEXT,
  color TEXT DEFAULT '#22c55e',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(farm_id, name)
);

-- Cattle groups (batch tracking, not individual animals)
CREATE TABLE IF NOT EXISTS cattle (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  section_id UUID REFERENCES sections(id) ON DELETE SET NULL,
  category TEXT NOT NULL DEFAULT 'vaca',
  breed TEXT,
  count INTEGER NOT NULL DEFAULT 1,
  tag_range TEXT,
  health_status TEXT DEFAULT 'healthy',
  notes TEXT,
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Activity log (every change is recorded)
CREATE TABLE IF NOT EXISTS activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  description TEXT NOT NULL,
  raw_message TEXT,
  message_type TEXT DEFAULT 'text',
  reported_by TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_sections_farm ON sections(farm_id);
CREATE INDEX IF NOT EXISTS idx_cattle_farm ON cattle(farm_id);
CREATE INDEX IF NOT EXISTS idx_cattle_section ON cattle(section_id);
CREATE INDEX IF NOT EXISTS idx_activities_farm ON activities(farm_id);
CREATE INDEX IF NOT EXISTS idx_activities_created ON activities(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_farms_phone ON farms(owner_phone);

-- Enable RLS (Row Level Security) - disabled for server-side access
ALTER TABLE farms ENABLE ROW LEVEL SECURITY;
ALTER TABLE sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE cattle ENABLE ROW LEVEL SECURITY;
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;

-- Service role policies (full access for server)
CREATE POLICY "Service role full access" ON farms FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON sections FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON cattle FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON activities FOR ALL USING (true) WITH CHECK (true);

-- Anon read access for dashboard
CREATE POLICY "Anon read farms" ON farms FOR SELECT USING (true);
CREATE POLICY "Anon read sections" ON sections FOR SELECT USING (true);
CREATE POLICY "Anon read cattle" ON cattle FOR SELECT USING (true);
CREATE POLICY "Anon read activities" ON activities FOR SELECT USING (true);

-- Seed a default farm (replace phone with your WhatsApp number)
-- INSERT INTO farms (name, owner_phone, total_hectares, location)
-- VALUES ('Mi Campo', '+5491112345678', 500, 'Buenos Aires');

-- ═══════════════════════════════════════════════════════════════
-- 002_auth.sql
-- ═══════════════════════════════════════════════════════════════
-- CampoAI Auth Migration
-- Run this in Supabase SQL Editor AFTER schema.sql

-- Add user_id to farms (links Supabase Auth users to their farms)
ALTER TABLE farms ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);
CREATE INDEX IF NOT EXISTS idx_farms_user ON farms(user_id);

-- Drop old open-access policies
DROP POLICY IF EXISTS "Anon read farms" ON farms;
DROP POLICY IF EXISTS "Anon read sections" ON sections;
DROP POLICY IF EXISTS "Anon read cattle" ON cattle;
DROP POLICY IF EXISTS "Anon read activities" ON activities;
DROP POLICY IF EXISTS "Service role full access" ON farms;
DROP POLICY IF EXISTS "Service role full access" ON sections;
DROP POLICY IF EXISTS "Service role full access" ON cattle;
DROP POLICY IF EXISTS "Service role full access" ON activities;

-- Service role: full access (for WhatsApp webhook + server operations)
CREATE POLICY "Service role full access" ON farms FOR ALL
  USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON sections FOR ALL
  USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON cattle FOR ALL
  USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON activities FOR ALL
  USING (true) WITH CHECK (true);

-- Authenticated users: can read/write their own farms
CREATE POLICY "Users read own farms" ON farms FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users update own farms" ON farms FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own farms" ON farms FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Authenticated users: access sections/cattle/activities for their farms
CREATE POLICY "Users read own sections" ON sections FOR SELECT
  USING (farm_id IN (SELECT id FROM farms WHERE user_id = auth.uid()));

CREATE POLICY "Users manage own sections" ON sections FOR ALL
  USING (farm_id IN (SELECT id FROM farms WHERE user_id = auth.uid()));

CREATE POLICY "Users read own cattle" ON cattle FOR SELECT
  USING (farm_id IN (SELECT id FROM farms WHERE user_id = auth.uid()));

CREATE POLICY "Users manage own cattle" ON cattle FOR ALL
  USING (farm_id IN (SELECT id FROM farms WHERE user_id = auth.uid()));

CREATE POLICY "Users read own activities" ON activities FOR SELECT
  USING (farm_id IN (SELECT id FROM farms WHERE user_id = auth.uid()));

CREATE POLICY "Users manage own activities" ON activities FOR ALL
  USING (farm_id IN (SELECT id FROM farms WHERE user_id = auth.uid()));

-- ═══════════════════════════════════════════════════════════════
-- 003_expanded.sql
-- ═══════════════════════════════════════════════════════════════
-- CampoAI Expanded Schema
-- Run AFTER 002_auth.sql

-- ═══════════════════════════════════════════════
-- Expand sections with field conditions
-- ═══════════════════════════════════════════════
ALTER TABLE sections ADD COLUMN IF NOT EXISTS water_status TEXT DEFAULT 'bueno';
  -- bueno, bajo, seco, inundado
ALTER TABLE sections ADD COLUMN IF NOT EXISTS pasture_status TEXT DEFAULT 'bueno';
  -- bueno, sobrepastoreado, seco, creciendo
ALTER TABLE sections ADD COLUMN IF NOT EXISTS notes TEXT;

-- ═══════════════════════════════════════════════
-- Expand cattle with more tracking fields
-- ═══════════════════════════════════════════════
ALTER TABLE cattle ADD COLUMN IF NOT EXISTS weight_kg NUMERIC;
ALTER TABLE cattle ADD COLUMN IF NOT EXISTS birth_date DATE;
ALTER TABLE cattle ADD COLUMN IF NOT EXISTS origin TEXT DEFAULT 'propio';
  -- propio, comprado, transferido
ALTER TABLE cattle ADD COLUMN IF NOT EXISTS vaccination_status TEXT DEFAULT 'pendiente';
  -- al_dia, pendiente, vencida
ALTER TABLE cattle ADD COLUMN IF NOT EXISTS last_vaccinated TIMESTAMPTZ;
ALTER TABLE cattle ADD COLUMN IF NOT EXISTS reproductive_status TEXT;
  -- prenada, lactando, servicio, vacia, NULL
ALTER TABLE cattle ADD COLUMN IF NOT EXISTS ear_tag TEXT;
  -- caravana individual or range

-- ═══════════════════════════════════════════════
-- Vaccinations table
-- ═══════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS vaccinations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  cattle_id UUID REFERENCES cattle(id) ON DELETE SET NULL,
  section_id UUID REFERENCES sections(id) ON DELETE SET NULL,
  vaccine_name TEXT NOT NULL,
  -- Common: Aftosa, Brucelosis, Carbunclo, Clostridiosis, Rabia, Leptospirosis, IBR, DVB, Antiparasitario
  date_applied TIMESTAMPTZ NOT NULL DEFAULT now(),
  next_due TIMESTAMPTZ,
  head_count INTEGER DEFAULT 1,
  applied_by TEXT,
  batch_number TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vaccinations_farm ON vaccinations(farm_id);
CREATE INDEX IF NOT EXISTS idx_vaccinations_date ON vaccinations(date_applied DESC);
CREATE INDEX IF NOT EXISTS idx_vaccinations_next_due ON vaccinations(next_due);

-- ═══════════════════════════════════════════════
-- Health events (births, deaths, injuries, treatments)
-- ═══════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS health_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  cattle_id UUID REFERENCES cattle(id) ON DELETE SET NULL,
  section_id UUID REFERENCES sections(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  -- nacimiento, muerte, enfermedad, lesion, tratamiento, revision, desparasitacion, destete, castrado
  description TEXT NOT NULL,
  date_occurred TIMESTAMPTZ NOT NULL DEFAULT now(),
  head_count INTEGER DEFAULT 1,
  resolved BOOLEAN DEFAULT false,
  veterinarian TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_health_farm ON health_events(farm_id);
CREATE INDEX IF NOT EXISTS idx_health_date ON health_events(date_occurred DESC);

-- ═══════════════════════════════════════════════
-- RLS for new tables (service role + user-scoped)
-- ═══════════════════════════════════════════════
ALTER TABLE vaccinations ENABLE ROW LEVEL SECURITY;
ALTER TABLE health_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON vaccinations FOR ALL
  USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON health_events FOR ALL
  USING (true) WITH CHECK (true);

CREATE POLICY "Users manage own vaccinations" ON vaccinations FOR ALL
  USING (farm_id IN (SELECT id FROM farms WHERE user_id = auth.uid()));
CREATE POLICY "Users manage own health events" ON health_events FOR ALL
  USING (farm_id IN (SELECT id FROM farms WHERE user_id = auth.uid()));

-- ═══════════════════════════════════════════════════════════════
-- 004_chat_messages.sql
-- ═══════════════════════════════════════════════════════════════
-- Chat message history for persistent conversations
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  role TEXT NOT NULL, -- 'user' or 'assistant'
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_farm ON chat_messages(farm_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON chat_messages(created_at DESC);

ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON chat_messages FOR ALL
  USING (true) WITH CHECK (true);

CREATE POLICY "Users manage own chat messages" ON chat_messages FOR ALL
  USING (farm_id IN (SELECT id FROM farms WHERE user_id = auth.uid()));

-- ═══════════════════════════════════════════════════════════════
-- 005_map.sql
-- ═══════════════════════════════════════════════════════════════
-- Padrones (land parcels from SNIG)
CREATE TABLE IF NOT EXISTS padrones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  padron_code TEXT NOT NULL, -- e.g. "D-995"
  padron_number INT NOT NULL,
  department_code TEXT NOT NULL, -- letter code e.g. "D"
  department_name TEXT,
  area_m2 DOUBLE PRECISION,
  geometry JSONB NOT NULL, -- GeoJSON geometry object
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_padrones_farm_code ON padrones(farm_id, padron_code);
CREATE INDEX IF NOT EXISTS idx_padrones_farm ON padrones(farm_id);

-- Link sections to padrones (a padron can have multiple sub-sections)
ALTER TABLE sections ADD COLUMN IF NOT EXISTS padron_id UUID REFERENCES padrones(id) ON DELETE SET NULL;

-- Map features (roads, porteras, aguadas, etc.)
CREATE TABLE IF NOT EXISTS map_features (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  type TEXT NOT NULL, -- 'road', 'portera', 'aguada', 'alambrado', 'manga', 'custom'
  name TEXT,
  geometry JSONB NOT NULL, -- GeoJSON geometry (LineString or Point)
  properties JSONB DEFAULT '{}', -- extra metadata
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_map_features_farm ON map_features(farm_id);

-- RLS
ALTER TABLE padrones ENABLE ROW LEVEL SECURITY;
ALTER TABLE map_features ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON padrones FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Users manage own padrones" ON padrones FOR ALL
  USING (farm_id IN (SELECT id FROM farms WHERE user_id = auth.uid()));

CREATE POLICY "Service role full access" ON map_features FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Users manage own map features" ON map_features FOR ALL
  USING (farm_id IN (SELECT id FROM farms WHERE user_id = auth.uid()));

-- ═══════════════════════════════════════════════════════════════
-- 006_section_map.sql
-- ═══════════════════════════════════════════════════════════════
-- Section map center for placing labels on padron subdivisions
ALTER TABLE sections ADD COLUMN IF NOT EXISTS map_center JSONB;
-- stores {"lat": -33.5, "lng": -56.2} for sub-section label placement

-- ═══════════════════════════════════════════════════════════════
-- 007_expansion.sql
-- ═══════════════════════════════════════════════════════════════
-- 007_expansion.sql
-- CampoAI Expansion: operation types, crops, inventory, financials

-- ─── 1. Farm operation type ───────────────────────
ALTER TABLE farms ADD COLUMN IF NOT EXISTS operation_type TEXT NOT NULL DEFAULT 'livestock';

-- ─── 2. Crops ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS crops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  section_id UUID REFERENCES sections(id) ON DELETE SET NULL,
  crop_type TEXT NOT NULL,
  variety TEXT,
  planted_hectares NUMERIC,
  planting_date DATE,
  expected_harvest DATE,
  actual_harvest DATE,
  yield_kg NUMERIC,
  yield_per_hectare NUMERIC GENERATED ALWAYS AS (yield_kg / NULLIF(planted_hectares, 0)) STORED,
  status TEXT NOT NULL DEFAULT 'planted',
  soil_type TEXT,
  irrigation_type TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crops_farm ON crops(farm_id);

CREATE TABLE IF NOT EXISTS crop_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  crop_id UUID NOT NULL REFERENCES crops(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  product_name TEXT,
  dose_per_hectare TEXT,
  total_applied TEXT,
  date_applied DATE,
  applied_by TEXT,
  weather_conditions TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crop_applications_crop ON crop_applications(crop_id);

-- ─── 3. Inventory ─────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  unit TEXT NOT NULL,
  current_stock NUMERIC NOT NULL DEFAULT 0,
  min_stock NUMERIC,
  cost_per_unit NUMERIC,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_items_farm ON inventory_items(farm_id);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  quantity NUMERIC NOT NULL,
  unit_cost NUMERIC,
  total_cost NUMERIC GENERATED ALWAYS AS (quantity * COALESCE(unit_cost, 0)) STORED,
  section_id UUID REFERENCES sections(id) ON DELETE SET NULL,
  crop_id UUID REFERENCES crops(id) ON DELETE SET NULL,
  cattle_id UUID REFERENCES cattle(id) ON DELETE SET NULL,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_item ON inventory_movements(item_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_farm ON inventory_movements(farm_id);

-- Trigger: update current_stock on movement insert
CREATE OR REPLACE FUNCTION update_inventory_stock()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE inventory_items
  SET current_stock = current_stock + NEW.quantity
  WHERE id = NEW.item_id;

  -- Update cost_per_unit on purchase
  IF NEW.type = 'compra' AND NEW.unit_cost IS NOT NULL THEN
    UPDATE inventory_items
    SET cost_per_unit = NEW.unit_cost
    WHERE id = NEW.item_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_inventory_stock_update
  AFTER INSERT ON inventory_movements
  FOR EACH ROW
  EXECUTE FUNCTION update_inventory_stock();

-- ─── 4. Financial Transactions ────────────────────
CREATE TABLE IF NOT EXISTS financial_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  amount NUMERIC NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  section_id UUID REFERENCES sections(id) ON DELETE SET NULL,
  crop_id UUID REFERENCES crops(id) ON DELETE SET NULL,
  cattle_id UUID REFERENCES cattle(id) ON DELETE SET NULL,
  inventory_movement_id UUID REFERENCES inventory_movements(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_financial_farm ON financial_transactions(farm_id);
CREATE INDEX IF NOT EXISTS idx_financial_date ON financial_transactions(farm_id, date);

-- ─── 5. RLS Policies ─────────────────────────────
ALTER TABLE crops ENABLE ROW LEVEL SECURITY;
ALTER TABLE crop_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on crops" ON crops FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on crop_applications" ON crop_applications FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on inventory_items" ON inventory_items FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on inventory_movements" ON inventory_movements FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on financial_transactions" ON financial_transactions FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Users access own crops" ON crops FOR ALL TO authenticated
  USING (farm_id IN (SELECT id FROM farms WHERE user_id = auth.uid()))
  WITH CHECK (farm_id IN (SELECT id FROM farms WHERE user_id = auth.uid()));

CREATE POLICY "Users access own crop_applications" ON crop_applications FOR ALL TO authenticated
  USING (farm_id IN (SELECT id FROM farms WHERE user_id = auth.uid()))
  WITH CHECK (farm_id IN (SELECT id FROM farms WHERE user_id = auth.uid()));

CREATE POLICY "Users access own inventory_items" ON inventory_items FOR ALL TO authenticated
  USING (farm_id IN (SELECT id FROM farms WHERE user_id = auth.uid()))
  WITH CHECK (farm_id IN (SELECT id FROM farms WHERE user_id = auth.uid()));

CREATE POLICY "Users access own inventory_movements" ON inventory_movements FOR ALL TO authenticated
  USING (farm_id IN (SELECT id FROM farms WHERE user_id = auth.uid()))
  WITH CHECK (farm_id IN (SELECT id FROM farms WHERE user_id = auth.uid()));

CREATE POLICY "Users access own financial_transactions" ON financial_transactions FOR ALL TO authenticated
  USING (farm_id IN (SELECT id FROM farms WHERE user_id = auth.uid()))
  WITH CHECK (farm_id IN (SELECT id FROM farms WHERE user_id = auth.uid()));

-- ═══════════════════════════════════════════════════════════════
-- 008_insights.sql
-- ═══════════════════════════════════════════════════════════════
-- 008_insights.sql
-- Cache for the AI weekly summary (one row per farm, upserted).

CREATE TABLE IF NOT EXISTS farm_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id UUID NOT NULL UNIQUE REFERENCES farms(id) ON DELETE CASCADE,
  summary TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_farm_insights_farm ON farm_insights(farm_id);

ALTER TABLE farm_insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on farm_insights" ON farm_insights FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Users access own farm_insights" ON farm_insights FOR ALL TO authenticated
  USING (farm_id IN (SELECT id FROM farms WHERE user_id = auth.uid()))
  WITH CHECK (farm_id IN (SELECT id FROM farms WHERE user_id = auth.uid()));

-- ═══════════════════════════════════════════════════════════════
-- 009_weight_records.sql
-- ═══════════════════════════════════════════════════════════════
-- 009_weight_records.sql
-- Weight history per cattle batch, for tracking average daily gain (ADG).

CREATE TABLE IF NOT EXISTS weight_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  cattle_id UUID NOT NULL REFERENCES cattle(id) ON DELETE CASCADE,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  weight_kg NUMERIC NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_weight_records_cattle ON weight_records(cattle_id, date);
CREATE INDEX IF NOT EXISTS idx_weight_records_farm ON weight_records(farm_id);

ALTER TABLE weight_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on weight_records" ON weight_records FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Users access own weight_records" ON weight_records FOR ALL TO authenticated
  USING (farm_id IN (SELECT id FROM farms WHERE user_id = auth.uid()))
  WITH CHECK (farm_id IN (SELECT id FROM farms WHERE user_id = auth.uid()));

-- ═══════════════════════════════════════════════════════════════
-- 010_integrity.sql
-- ═══════════════════════════════════════════════════════════════
CREATE UNIQUE INDEX IF NOT EXISTS idx_farms_user_unique
  ON farms(user_id) WHERE user_id IS NOT NULL;

ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD';

CREATE OR REPLACE FUNCTION public.record_inventory_purchase(
  p_farm_id UUID, p_item_id UUID, p_quantity NUMERIC, p_unit_cost NUMERIC,
  p_section_id UUID DEFAULT NULL, p_crop_id UUID DEFAULT NULL,
  p_cattle_id UUID DEFAULT NULL, p_date DATE DEFAULT CURRENT_DATE,
  p_notes TEXT DEFAULT NULL, p_currency TEXT DEFAULT 'USD'
)
RETURNS UUID LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_item inventory_items%ROWTYPE; v_movement_id UUID;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN RAISE EXCEPTION 'purchase quantity must be positive'; END IF;
  IF p_unit_cost IS NULL OR p_unit_cost < 0 THEN RAISE EXCEPTION 'unit cost must be non-negative'; END IF;
  IF p_currency NOT IN ('USD', 'UYU', 'ARS') THEN RAISE EXCEPTION 'unsupported currency'; END IF;
  SELECT * INTO v_item FROM inventory_items WHERE id = p_item_id AND farm_id = p_farm_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'inventory item not found'; END IF;
  IF p_section_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sections WHERE id = p_section_id AND farm_id = p_farm_id) THEN RAISE EXCEPTION 'section does not belong to farm'; END IF;
  IF p_crop_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM crops WHERE id = p_crop_id AND farm_id = p_farm_id) THEN RAISE EXCEPTION 'crop does not belong to farm'; END IF;
  IF p_cattle_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM cattle WHERE id = p_cattle_id AND farm_id = p_farm_id) THEN RAISE EXCEPTION 'cattle does not belong to farm'; END IF;
  INSERT INTO inventory_movements (farm_id, item_id, type, quantity, unit_cost, currency, section_id, crop_id, cattle_id, date, notes)
  VALUES (p_farm_id, p_item_id, 'compra', p_quantity, p_unit_cost, p_currency, p_section_id, p_crop_id, p_cattle_id, p_date, p_notes)
  RETURNING id INTO v_movement_id;
  INSERT INTO financial_transactions (farm_id, type, category, description, amount, currency, date, section_id, crop_id, cattle_id, inventory_movement_id, notes)
  VALUES (p_farm_id, 'egreso', 'compra_insumo', 'Compra: ' || v_item.name, p_quantity * p_unit_cost, p_currency, p_date, p_section_id, p_crop_id, p_cattle_id, v_movement_id, p_notes);
  RETURN v_movement_id;
END; $$;

CREATE OR REPLACE FUNCTION public.record_weight(
  p_farm_id UUID, p_cattle_id UUID, p_date DATE, p_weight_kg NUMERIC, p_notes TEXT DEFAULT NULL
)
RETURNS UUID LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_record_id UUID;
BEGIN
  IF p_weight_kg IS NULL OR p_weight_kg <= 0 THEN RAISE EXCEPTION 'weight must be positive'; END IF;
  IF NOT EXISTS (SELECT 1 FROM cattle WHERE id = p_cattle_id AND farm_id = p_farm_id) THEN RAISE EXCEPTION 'cattle batch not found'; END IF;
  INSERT INTO weight_records (farm_id, cattle_id, date, weight_kg, notes) VALUES (p_farm_id, p_cattle_id, p_date, p_weight_kg, p_notes) RETURNING id INTO v_record_id;
  UPDATE cattle SET weight_kg = (SELECT weight_kg FROM weight_records WHERE cattle_id = p_cattle_id AND farm_id = p_farm_id ORDER BY date DESC, created_at DESC LIMIT 1), updated_at = now()
  WHERE id = p_cattle_id AND farm_id = p_farm_id;
  RETURN v_record_id;
END; $$;

REVOKE ALL ON FUNCTION public.record_inventory_purchase(UUID, UUID, NUMERIC, NUMERIC, UUID, UUID, UUID, DATE, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_weight(UUID, UUID, DATE, NUMERIC, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_inventory_purchase(UUID, UUID, NUMERIC, NUMERIC, UUID, UUID, UUID, DATE, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_weight(UUID, UUID, DATE, NUMERIC, TEXT) TO service_role;

-- ═══════════════════════════════════════════════════════════════
-- 011_whatsapp_events.sql
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS whatsapp_events (
  message_id TEXT PRIMARY KEY, sender_phone TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing', created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_events_created ON whatsapp_events(created_at);
ALTER TABLE whatsapp_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON whatsapp_events FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════
-- 012_audit_triggers.sql
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.log_field_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_farm_id uuid; v_id uuid; v_action text := lower(TG_OP);
BEGIN
  IF TG_TABLE_NAME = 'activities' THEN IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF; END IF;
  v_farm_id := COALESCE(NEW.farm_id, OLD.farm_id);
  v_id := COALESCE(NEW.id, OLD.id);
  IF v_farm_id IS NULL THEN IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF; END IF;
  INSERT INTO public.activities (farm_id, type, description, message_type, metadata)
  VALUES (v_farm_id, 'registration',
    format('%s %s (%s)', initcap(v_action), replace(TG_TABLE_NAME, '_', ' '), v_id),
    'text', jsonb_build_object('table', TG_TABLE_NAME, 'action', v_action, 'record_id', v_id));
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END; $$;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'sections', 'cattle', 'crops', 'crop_applications',
    'inventory_items', 'inventory_movements', 'financial_transactions',
    'vaccinations', 'health_events', 'weight_records', 'padrones', 'map_features'
  ] LOOP
    IF to_regclass('public.' || table_name) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS audit_%I ON public.%I', table_name, table_name);
      EXECUTE format('CREATE TRIGGER audit_%I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.log_field_mutation()', table_name, table_name);
    END IF;
  END LOOP;
END; $$;

-- ═══════════════════════════════════════════════════════════════
-- 013_inventory_currency.sql
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE inventory_movements
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD';

CREATE OR REPLACE FUNCTION update_inventory_stock()
RETURNS TRIGGER AS $$
BEGIN
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
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════════
-- 014_tasks.sql
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (char_length(trim(title)) BETWEEN 1 AND 160),
  description TEXT,
  due_date DATE,
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
  section_id UUID REFERENCES sections(id) ON DELETE SET NULL,
  cattle_id UUID REFERENCES cattle(id) ON DELETE SET NULL,
  crop_id UUID REFERENCES crops(id) ON DELETE SET NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tasks_farm_status_due ON tasks(farm_id, status, due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_section ON tasks(section_id);
CREATE INDEX IF NOT EXISTS idx_tasks_cattle ON tasks(cattle_id);
CREATE INDEX IF NOT EXISTS idx_tasks_crop ON tasks(crop_id);
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on tasks" ON tasks FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Users access own tasks" ON tasks FOR ALL TO authenticated
  USING (farm_id IN (SELECT id FROM farms WHERE user_id = auth.uid()))
  WITH CHECK (farm_id IN (SELECT id FROM farms WHERE user_id = auth.uid()));
DROP TRIGGER IF EXISTS audit_tasks ON tasks;
CREATE TRIGGER audit_tasks AFTER INSERT OR UPDATE OR DELETE ON tasks
  FOR EACH ROW EXECUTE FUNCTION public.log_field_mutation();

-- ═══════════════════════════════════════════════════════════════
-- 015_financial_inventory_links.sql
-- ═══════════════════════════════════════════════════════════════
CREATE UNIQUE INDEX IF NOT EXISTS idx_financial_inventory_movement_unique
  ON financial_transactions(inventory_movement_id)
  WHERE inventory_movement_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════
-- 016_cattle_ear_tags.sql
-- ═══════════════════════════════════════════════════════════════
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

-- ═══════════════════════════════════════════════════════════════
-- 017_idempotency.sql
-- ═══════════════════════════════════════════════════════════════
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
  p_farm_id UUID, p_item_id UUID, p_quantity NUMERIC, p_unit_cost NUMERIC,
  p_section_id UUID DEFAULT NULL, p_crop_id UUID DEFAULT NULL,
  p_cattle_id UUID DEFAULT NULL, p_date DATE DEFAULT CURRENT_DATE,
  p_notes TEXT DEFAULT NULL, p_currency TEXT DEFAULT 'USD',
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS UUID LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_item inventory_items%ROWTYPE; v_movement_id UUID;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN RAISE EXCEPTION 'purchase quantity must be positive'; END IF;
  IF p_unit_cost IS NULL OR p_unit_cost < 0 THEN RAISE EXCEPTION 'unit cost must be non-negative'; END IF;
  IF p_currency NOT IN ('USD', 'UYU', 'ARS') THEN RAISE EXCEPTION 'unsupported currency'; END IF;
  SELECT * INTO v_item FROM inventory_items WHERE id = p_item_id AND farm_id = p_farm_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'inventory item not found'; END IF;
  IF p_section_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sections WHERE id = p_section_id AND farm_id = p_farm_id) THEN RAISE EXCEPTION 'section does not belong to farm'; END IF;
  IF p_crop_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM crops WHERE id = p_crop_id AND farm_id = p_farm_id) THEN RAISE EXCEPTION 'crop does not belong to farm'; END IF;
  IF p_cattle_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM cattle WHERE id = p_cattle_id AND farm_id = p_farm_id) THEN RAISE EXCEPTION 'cattle does not belong to farm'; END IF;
  INSERT INTO inventory_movements (farm_id, item_id, type, quantity, unit_cost, currency, section_id, crop_id, cattle_id, date, notes, idempotency_key)
  VALUES (p_farm_id, p_item_id, 'compra', p_quantity, p_unit_cost, p_currency, p_section_id, p_crop_id, p_cattle_id, p_date, p_notes, p_idempotency_key)
  ON CONFLICT (farm_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
  RETURNING id INTO v_movement_id;
  IF v_movement_id IS NULL AND p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_movement_id FROM inventory_movements WHERE farm_id = p_farm_id AND idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_movement_id; END IF;
    RAISE EXCEPTION 'idempotent purchase could not be resolved';
  END IF;
  INSERT INTO financial_transactions (farm_id, type, category, description, amount, currency, date, section_id, crop_id, cattle_id, inventory_movement_id, notes)
  VALUES (p_farm_id, 'egreso', 'compra_insumo', 'Compra: ' || v_item.name, p_quantity * p_unit_cost, p_currency, p_date, p_section_id, p_crop_id, p_cattle_id, v_movement_id, p_notes);
  RETURN v_movement_id;
END; $$;

CREATE FUNCTION public.record_weight(
  p_farm_id UUID, p_cattle_id UUID, p_date DATE, p_weight_kg NUMERIC,
  p_notes TEXT DEFAULT NULL, p_idempotency_key TEXT DEFAULT NULL
)
RETURNS UUID LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_record_id UUID;
BEGIN
  IF p_weight_kg IS NULL OR p_weight_kg <= 0 THEN RAISE EXCEPTION 'weight must be positive'; END IF;
  IF NOT EXISTS (SELECT 1 FROM cattle WHERE id = p_cattle_id AND farm_id = p_farm_id) THEN RAISE EXCEPTION 'cattle batch not found'; END IF;
  INSERT INTO weight_records (farm_id, cattle_id, date, weight_kg, notes, idempotency_key)
  VALUES (p_farm_id, p_cattle_id, p_date, p_weight_kg, p_notes, p_idempotency_key)
  ON CONFLICT (farm_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
  RETURNING id INTO v_record_id;
  IF v_record_id IS NULL AND p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_record_id FROM weight_records WHERE farm_id = p_farm_id AND idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_record_id; END IF;
    RAISE EXCEPTION 'idempotent weight could not be resolved';
  END IF;
  UPDATE cattle SET weight_kg = (SELECT weight_kg FROM weight_records WHERE cattle_id = p_cattle_id AND farm_id = p_farm_id ORDER BY date DESC, created_at DESC LIMIT 1), updated_at = now()
  WHERE id = p_cattle_id AND farm_id = p_farm_id;
  RETURN v_record_id;
END; $$;

REVOKE ALL ON FUNCTION public.record_inventory_purchase(UUID, UUID, NUMERIC, NUMERIC, UUID, UUID, UUID, DATE, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_weight(UUID, UUID, DATE, NUMERIC, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_inventory_purchase(UUID, UUID, NUMERIC, NUMERIC, UUID, UUID, UUID, DATE, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_weight(UUID, UUID, DATE, NUMERIC, TEXT, TEXT) TO service_role;

-- ═══════════════════════════════════════════════════════════════
-- 018_padron_transaction.sql
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.create_padron_with_section(
  p_farm_id UUID, p_padron_code TEXT, p_padron_number INTEGER,
  p_department_code TEXT DEFAULT NULL, p_department_name TEXT DEFAULT NULL,
  p_area_m2 NUMERIC DEFAULT NULL, p_geometry JSONB DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_padron padrones%ROWTYPE; v_section sections%ROWTYPE;
BEGIN
  IF p_padron_code IS NULL OR p_padron_code = '' THEN RAISE EXCEPTION 'padron code is required'; END IF;
  IF p_padron_number IS NULL OR p_padron_number < 0 THEN RAISE EXCEPTION 'padron number must be non-negative'; END IF;
  IF p_area_m2 IS NOT NULL AND p_area_m2 <= 0 THEN RAISE EXCEPTION 'padron area must be positive'; END IF;
  IF p_geometry IS NULL OR p_geometry->>'type' IS NULL OR NOT (p_geometry ? 'coordinates') THEN RAISE EXCEPTION 'padron geometry is invalid'; END IF;
  INSERT INTO padrones (farm_id, padron_code, padron_number, department_code, department_name, area_m2, geometry)
  VALUES (p_farm_id, p_padron_code, p_padron_number, p_department_code, p_department_name, p_area_m2, p_geometry)
  RETURNING * INTO v_padron;
  INSERT INTO sections (farm_id, padron_id, name, size_hectares, color, water_status, pasture_status)
  VALUES (p_farm_id, v_padron.id, p_padron_code, CASE WHEN p_area_m2 IS NULL THEN NULL ELSE round((p_area_m2 / 10000.0)::numeric, 1) END, '#22c55e', 'bueno', 'bueno')
  RETURNING * INTO v_section;
  RETURN jsonb_build_object('padron', to_jsonb(v_padron), 'section', to_jsonb(v_section));
END; $$;

REVOKE ALL ON FUNCTION public.create_padron_with_section(UUID, TEXT, INTEGER, TEXT, TEXT, NUMERIC, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_padron_with_section(UUID, TEXT, INTEGER, TEXT, TEXT, NUMERIC, JSONB) TO service_role;

-- ═══════════════════════════════════════════════════════════════
-- 019_padron_idempotency.sql
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE padrones
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_padrones_idempotency
  ON padrones(farm_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

DROP FUNCTION IF EXISTS public.create_padron_with_section(UUID, TEXT, INTEGER, TEXT, TEXT, NUMERIC, JSONB);

CREATE FUNCTION public.create_padron_with_section(
  p_farm_id UUID, p_padron_code TEXT, p_padron_number INTEGER,
  p_department_code TEXT DEFAULT NULL, p_department_name TEXT DEFAULT NULL,
  p_area_m2 NUMERIC DEFAULT NULL, p_geometry JSONB DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_padron padrones%ROWTYPE; v_section sections%ROWTYPE;
BEGIN
  IF p_padron_code IS NULL OR p_padron_code = '' THEN RAISE EXCEPTION 'padron code is required'; END IF;
  IF p_padron_number IS NULL OR p_padron_number < 0 THEN RAISE EXCEPTION 'padron number must be non-negative'; END IF;
  IF p_area_m2 IS NOT NULL AND p_area_m2 <= 0 THEN RAISE EXCEPTION 'padron area must be positive'; END IF;
  IF p_geometry IS NULL OR p_geometry->>'type' IS NULL OR NOT (p_geometry ? 'coordinates') THEN RAISE EXCEPTION 'padron geometry is invalid'; END IF;
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_padron FROM padrones WHERE farm_id = p_farm_id AND idempotency_key = p_idempotency_key;
    IF FOUND THEN
      SELECT * INTO v_section FROM sections WHERE farm_id = p_farm_id AND padron_id = v_padron.id ORDER BY created_at LIMIT 1;
      IF FOUND THEN RETURN jsonb_build_object('padron', to_jsonb(v_padron), 'section', to_jsonb(v_section)); END IF;
      RAISE EXCEPTION 'idempotent padron has no section';
    END IF;
  END IF;
  INSERT INTO padrones (farm_id, padron_code, padron_number, department_code, department_name, area_m2, geometry, idempotency_key)
  VALUES (p_farm_id, p_padron_code, p_padron_number, p_department_code, p_department_name, p_area_m2, p_geometry, p_idempotency_key)
  ON CONFLICT (farm_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
  RETURNING * INTO v_padron;
  IF v_padron.id IS NULL AND p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_padron FROM padrones WHERE farm_id = p_farm_id AND idempotency_key = p_idempotency_key;
    IF NOT FOUND THEN RAISE EXCEPTION 'idempotent padron could not be resolved'; END IF;
    SELECT * INTO v_section FROM sections WHERE farm_id = p_farm_id AND padron_id = v_padron.id ORDER BY created_at LIMIT 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'idempotent padron has no section'; END IF;
    RETURN jsonb_build_object('padron', to_jsonb(v_padron), 'section', to_jsonb(v_section));
  END IF;
  INSERT INTO sections (farm_id, padron_id, name, size_hectares, color, water_status, pasture_status)
  VALUES (p_farm_id, v_padron.id, p_padron_code, CASE WHEN p_area_m2 IS NULL THEN NULL ELSE round((p_area_m2 / 10000.0)::numeric, 1) END, '#22c55e', 'bueno', 'bueno')
  RETURNING * INTO v_section;
  RETURN jsonb_build_object('padron', to_jsonb(v_padron), 'section', to_jsonb(v_section));
END; $$;

REVOKE ALL ON FUNCTION public.create_padron_with_section(UUID, TEXT, INTEGER, TEXT, TEXT, NUMERIC, JSONB, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_padron_with_section(UUID, TEXT, INTEGER, TEXT, TEXT, NUMERIC, JSONB, TEXT) TO service_role;

-- ═══════════════════════════════════════════════════════════════
-- 020_import_idempotency.sql
-- ═══════════════════════════════════════════════════════════════
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

-- ═══════════════════════════════════════════════════════════════
-- 021_cattle_move_transaction.sql
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.move_cattle(
  p_farm_id UUID,
  p_source_cattle_id UUID,
  p_destination_section_id UUID,
  p_move_count INTEGER
)
RETURNS TABLE (source_id UUID, destination_id UUID, moved_count INTEGER, move_mode TEXT)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_source cattle%ROWTYPE; v_destination_id UUID;
BEGIN
  IF p_move_count IS NULL OR p_move_count <= 0 THEN RAISE EXCEPTION 'move count must be positive'; END IF;
  SELECT * INTO v_source FROM cattle WHERE id = p_source_cattle_id AND farm_id = p_farm_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'source cattle batch not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM sections WHERE id = p_destination_section_id AND farm_id = p_farm_id) THEN
    RAISE EXCEPTION 'destination section does not belong to farm';
  END IF;
  IF v_source.section_id = p_destination_section_id THEN
    RETURN QUERY SELECT v_source.id, NULL::UUID, 0, 'noop'::TEXT;
    RETURN;
  END IF;
  IF p_move_count >= v_source.count THEN
    UPDATE cattle SET section_id = p_destination_section_id, updated_at = now()
    WHERE id = v_source.id AND farm_id = p_farm_id;
    RETURN QUERY SELECT v_source.id, NULL::UUID, v_source.count, 'all'::TEXT;
    RETURN;
  END IF;
  UPDATE cattle SET count = v_source.count - p_move_count, updated_at = now()
  WHERE id = v_source.id AND farm_id = p_farm_id;
  INSERT INTO cattle (
    farm_id, section_id, category, breed, count, tag_range, health_status,
    notes, weight_kg, birth_date, origin, vaccination_status, last_vaccinated,
    reproductive_status, ear_tag
  ) VALUES (
    p_farm_id, p_destination_section_id, v_source.category, v_source.breed,
    p_move_count, v_source.tag_range, v_source.health_status, NULL,
    v_source.weight_kg, v_source.birth_date, v_source.origin,
    v_source.vaccination_status, v_source.last_vaccinated,
    v_source.reproductive_status, NULL
  ) RETURNING id INTO v_destination_id;
  RETURN QUERY SELECT v_source.id, v_destination_id, p_move_count, 'split'::TEXT;
END; $$;

REVOKE ALL ON FUNCTION public.move_cattle(UUID, UUID, UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.move_cattle(UUID, UUID, UUID, INTEGER) TO service_role;

-- ═══════════════════════════════════════════════════════════════
-- 022_task_idempotency.sql
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_idempotency
  ON tasks(farm_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════
-- 023_financial_idempotency.sql
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE financial_transactions
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_financial_transactions_idempotency
  ON financial_transactions(farm_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════
-- 024_operational_idempotency.sql
-- ═══════════════════════════════════════════════════════════════
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

-- ═══════════════════════════════════════════════════════════════
-- 025_map_feature_idempotency.sql
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE map_features
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_map_features_idempotency
  ON map_features(farm_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════
-- 026_chat_request_idempotency.sql
-- ═══════════════════════════════════════════════════════════════
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

CREATE POLICY "Service role full access" ON chat_requests FOR ALL
  USING (true) WITH CHECK (true);

CREATE POLICY "Users manage own chat requests" ON chat_requests FOR ALL
  USING (farm_id IN (SELECT id FROM farms WHERE user_id = auth.uid()));

-- ═══════════════════════════════════════════════════════════════
-- 027_whatsapp_side_effects.sql
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE whatsapp_events
  ADD COLUMN IF NOT EXISTS response_text TEXT;

-- ═══════════════════════════════════════════════════════════════
-- 028_sample_data_idempotency.sql
-- ═══════════════════════════════════════════════════════════════
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

CREATE POLICY "Service role full access" ON sample_data_requests FOR ALL
  USING (true) WITH CHECK (true);

CREATE POLICY "Users manage own sample data requests" ON sample_data_requests FOR ALL
  USING (user_id = auth.uid());

-- ═══════════════════════════════════════════════════════════════
-- 029_hacienda_idempotency.sql
-- ═══════════════════════════════════════════════════════════════
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

-- ═══════════════════════════════════════════════════════════════
-- 030_inventory_item_idempotency.sql
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_items_idempotency
  ON inventory_items(farm_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════
-- 031_farm_memberships.sql
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS farm_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  role TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('owner', 'editor', 'viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (farm_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_farm_members_user ON farm_members(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_farm_members_farm ON farm_members(farm_id, created_at);

INSERT INTO farm_members (farm_id, user_id, email, role)
SELECT f.id, f.user_id, u.email, 'owner'
FROM farms f
LEFT JOIN auth.users u ON u.id = f.user_id
WHERE f.user_id IS NOT NULL
ON CONFLICT (farm_id, user_id) DO UPDATE
SET role = 'owner', email = COALESCE(EXCLUDED.email, farm_members.email);

CREATE TABLE IF NOT EXISTS farm_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('editor', 'viewer')),
  token_hash TEXT NOT NULL UNIQUE,
  invited_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_at TIMESTAMPTZ,
  accepted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_farm_invites_farm ON farm_invites(farm_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_farm_invites_email ON farm_invites(lower(email), expires_at);

ALTER TABLE farm_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE farm_invites ENABLE ROW LEVEL SECURITY;

-- Older setup scripts used this policy name without `TO service_role`, which
-- makes it apply to every role. Recreate those policies with the intended
-- scope before adding the shared-access policies below.
DO $$
DECLARE
  table_name TEXT;
  service_tables CONSTANT TEXT[] := ARRAY[
    'farms', 'sections', 'cattle', 'activities', 'chat_messages',
    'padrones', 'map_features', 'chat_requests', 'whatsapp_events',
    'sample_data_requests'
  ];
BEGIN
  FOREACH table_name IN ARRAY service_tables LOOP
    IF to_regclass('public.' || table_name) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Service role full access', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
      'Service role full access', table_name
    );
  END LOOP;

  DROP POLICY IF EXISTS "Anon read farms" ON farms;
  DROP POLICY IF EXISTS "Anon read sections" ON sections;
  DROP POLICY IF EXISTS "Anon read cattle" ON cattle;
  DROP POLICY IF EXISTS "Anon read activities" ON activities;
END $$;

CREATE OR REPLACE FUNCTION public.is_farm_owner(p_farm_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM farms WHERE id = p_farm_id AND user_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.has_farm_role(p_farm_id UUID, p_roles TEXT[])
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM farm_members WHERE farm_id = p_farm_id AND user_id = auth.uid() AND role = ANY(p_roles));
$$;

REVOKE ALL ON FUNCTION public.is_farm_owner(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_farm_role(UUID, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_farm_owner(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_farm_role(UUID, TEXT[]) TO authenticated, service_role;

DROP POLICY IF EXISTS "Members read farm memberships" ON farm_members;
CREATE POLICY "Members read farm memberships" ON farm_members FOR SELECT
  USING (
    user_id = auth.uid()
    OR public.is_farm_owner(farm_id)
  );

DROP POLICY IF EXISTS "Owners manage farm memberships" ON farm_members;
CREATE POLICY "Owners manage farm memberships" ON farm_members FOR ALL
  USING (public.is_farm_owner(farm_id))
  WITH CHECK (public.is_farm_owner(farm_id));

DROP POLICY IF EXISTS "Owners manage farm invites" ON farm_invites;
CREATE POLICY "Owners manage farm invites" ON farm_invites FOR ALL
  USING (public.is_farm_owner(farm_id))
  WITH CHECK (public.is_farm_owner(farm_id));

DO $$
DECLARE
  table_name TEXT;
  shared_tables CONSTANT TEXT[] := ARRAY[
    'sections', 'cattle', 'activities', 'vaccinations', 'health_events',
    'chat_messages', 'padrones', 'map_features', 'crops', 'crop_applications',
    'inventory_items', 'inventory_movements', 'financial_transactions',
    'farm_insights', 'weight_records', 'tasks', 'chat_requests'
  ];
BEGIN
  FOREACH table_name IN ARRAY shared_tables LOOP
    IF to_regclass('public.' || table_name) IS NULL THEN CONTINUE; END IF;

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Members read shared ' || table_name, table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT USING (public.has_farm_role(public.%I.farm_id, ARRAY[''owner'', ''editor'', ''viewer'']))',
      'Members read shared ' || table_name, table_name, table_name
    );

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Editors manage shared ' || table_name, table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL USING (public.has_farm_role(public.%I.farm_id, ARRAY[''owner'', ''editor''])) WITH CHECK (public.has_farm_role(public.%I.farm_id, ARRAY[''owner'', ''editor'']))',
      'Editors manage shared ' || table_name, table_name, table_name, table_name
    );
  END LOOP;

  DROP POLICY IF EXISTS "Members read shared farms" ON farms;
  CREATE POLICY "Members read shared farms" ON farms FOR SELECT
    USING (public.has_farm_role(farms.id, ARRAY['owner', 'editor', 'viewer']));

  DROP POLICY IF EXISTS "Editors update shared farms" ON farms;
  CREATE POLICY "Editors update shared farms" ON farms FOR UPDATE
    USING (public.has_farm_role(farms.id, ARRAY['owner', 'editor']))
    WITH CHECK (public.has_farm_role(farms.id, ARRAY['owner', 'editor']));
END $$;
