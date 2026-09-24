-- CampoAI — one-shot database setup
-- Generated from the ordered migrations. Run ONCE on a fresh Supabase project
-- (SQL Editor → paste → Run). Every CREATE POLICY is now paired with a
-- preceding DROP POLICY IF EXISTS and every CREATE FUNCTION is
-- CREATE OR REPLACE, so those two failure modes are re-run-safe — but this
-- file still has unguarded ALTER TABLE ... ADD CONSTRAINT statements, so
-- re-running it on an existing DB will still error on those.
-- Apply order: schema.sql, then 002 through 044 in numeric order (all included below).


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
DROP POLICY IF EXISTS "Service role full access" ON farms;
CREATE POLICY "Service role full access" ON farms FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Service role full access" ON sections;
CREATE POLICY "Service role full access" ON sections FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Service role full access" ON cattle;
CREATE POLICY "Service role full access" ON cattle FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Service role full access" ON activities;
CREATE POLICY "Service role full access" ON activities FOR ALL USING (true) WITH CHECK (true);

-- Anon read access for dashboard
DROP POLICY IF EXISTS "Anon read farms" ON farms;
CREATE POLICY "Anon read farms" ON farms FOR SELECT USING (true);
DROP POLICY IF EXISTS "Anon read sections" ON sections;
CREATE POLICY "Anon read sections" ON sections FOR SELECT USING (true);
DROP POLICY IF EXISTS "Anon read cattle" ON cattle;
CREATE POLICY "Anon read cattle" ON cattle FOR SELECT USING (true);
DROP POLICY IF EXISTS "Anon read activities" ON activities;
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
DROP POLICY IF EXISTS "Service role full access" ON farms;
CREATE POLICY "Service role full access" ON farms FOR ALL
  USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Service role full access" ON sections;
CREATE POLICY "Service role full access" ON sections FOR ALL
  USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Service role full access" ON cattle;
CREATE POLICY "Service role full access" ON cattle FOR ALL
  USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Service role full access" ON activities;
CREATE POLICY "Service role full access" ON activities FOR ALL
  USING (true) WITH CHECK (true);

-- Authenticated users: can read/write their own farms
DROP POLICY IF EXISTS "Users read own farms" ON farms;
CREATE POLICY "Users read own farms" ON farms FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own farms" ON farms;
CREATE POLICY "Users update own farms" ON farms FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own farms" ON farms;
CREATE POLICY "Users insert own farms" ON farms FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Authenticated users: access sections/cattle/activities for their farms
DROP POLICY IF EXISTS "Users read own sections" ON sections;
CREATE POLICY "Users read own sections" ON sections FOR SELECT
  USING (farm_id IN (SELECT id FROM farms WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Users manage own sections" ON sections;
CREATE POLICY "Users manage own sections" ON sections FOR ALL
  USING (farm_id IN (SELECT id FROM farms WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Users read own cattle" ON cattle;
CREATE POLICY "Users read own cattle" ON cattle FOR SELECT
  USING (farm_id IN (SELECT id FROM farms WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Users manage own cattle" ON cattle;
CREATE POLICY "Users manage own cattle" ON cattle FOR ALL
  USING (farm_id IN (SELECT id FROM farms WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Users read own activities" ON activities;
CREATE POLICY "Users read own activities" ON activities FOR SELECT
  USING (farm_id IN (SELECT id FROM farms WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Users manage own activities" ON activities;
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

DROP POLICY IF EXISTS "Service role full access" ON vaccinations;
CREATE POLICY "Service role full access" ON vaccinations FOR ALL
  USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Service role full access" ON health_events;
CREATE POLICY "Service role full access" ON health_events FOR ALL
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Users manage own vaccinations" ON vaccinations;
CREATE POLICY "Users manage own vaccinations" ON vaccinations FOR ALL
  USING (farm_id IN (SELECT id FROM farms WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS "Users manage own health events" ON health_events;
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

DROP POLICY IF EXISTS "Service role full access" ON chat_messages;
CREATE POLICY "Service role full access" ON chat_messages FOR ALL
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Users manage own chat messages" ON chat_messages;
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

DROP POLICY IF EXISTS "Service role full access" ON padrones;
CREATE POLICY "Service role full access" ON padrones FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Users manage own padrones" ON padrones;
CREATE POLICY "Users manage own padrones" ON padrones FOR ALL
  USING (farm_id IN (SELECT id FROM farms WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Service role full access" ON map_features;
CREATE POLICY "Service role full access" ON map_features FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Users manage own map features" ON map_features;
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

DROP POLICY IF EXISTS "Service role full access on crops" ON crops;
CREATE POLICY "Service role full access on crops" ON crops FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Service role full access on crop_applications" ON crop_applications;
CREATE POLICY "Service role full access on crop_applications" ON crop_applications FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Service role full access on inventory_items" ON inventory_items;
CREATE POLICY "Service role full access on inventory_items" ON inventory_items FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Service role full access on inventory_movements" ON inventory_movements;
CREATE POLICY "Service role full access on inventory_movements" ON inventory_movements FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Service role full access on financial_transactions" ON financial_transactions;
CREATE POLICY "Service role full access on financial_transactions" ON financial_transactions FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Users access own crops" ON crops;
CREATE POLICY "Users access own crops" ON crops FOR ALL TO authenticated
  USING (farm_id IN (SELECT id FROM farms WHERE user_id = auth.uid()))
  WITH CHECK (farm_id IN (SELECT id FROM farms WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Users access own crop_applications" ON crop_applications;
CREATE POLICY "Users access own crop_applications" ON crop_applications FOR ALL TO authenticated
  USING (farm_id IN (SELECT id FROM farms WHERE user_id = auth.uid()))
  WITH CHECK (farm_id IN (SELECT id FROM farms WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Users access own inventory_items" ON inventory_items;
CREATE POLICY "Users access own inventory_items" ON inventory_items FOR ALL TO authenticated
  USING (farm_id IN (SELECT id FROM farms WHERE user_id = auth.uid()))
  WITH CHECK (farm_id IN (SELECT id FROM farms WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Users access own inventory_movements" ON inventory_movements;
CREATE POLICY "Users access own inventory_movements" ON inventory_movements FOR ALL TO authenticated
  USING (farm_id IN (SELECT id FROM farms WHERE user_id = auth.uid()))
  WITH CHECK (farm_id IN (SELECT id FROM farms WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Users access own financial_transactions" ON financial_transactions;
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

DROP POLICY IF EXISTS "Service role full access on farm_insights" ON farm_insights;
CREATE POLICY "Service role full access on farm_insights" ON farm_insights FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Users access own farm_insights" ON farm_insights;
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

DROP POLICY IF EXISTS "Service role full access on weight_records" ON weight_records;
CREATE POLICY "Service role full access on weight_records" ON weight_records FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Users access own weight_records" ON weight_records;
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
DROP POLICY IF EXISTS "Service role full access" ON whatsapp_events;
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
DROP POLICY IF EXISTS "Service role full access on tasks" ON tasks;
CREATE POLICY "Service role full access on tasks" ON tasks FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Users access own tasks" ON tasks;
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

CREATE OR REPLACE FUNCTION public.record_inventory_purchase(
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

CREATE OR REPLACE FUNCTION public.record_weight(
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

CREATE OR REPLACE FUNCTION public.create_padron_with_section(
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

DROP POLICY IF EXISTS "Service role full access" ON chat_requests;
CREATE POLICY "Service role full access" ON chat_requests FOR ALL
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Users manage own chat requests" ON chat_requests;
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

DROP POLICY IF EXISTS "Service role full access" ON sample_data_requests;
CREATE POLICY "Service role full access" ON sample_data_requests FOR ALL
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Users manage own sample data requests" ON sample_data_requests;
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
-- CampoAI farm sharing.
-- Owners keep the legacy farms.user_id link; memberships add editor/viewer
-- access without breaking deployments that have not applied this migration yet.

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
    'vaccinations', 'health_events', 'padrones', 'map_features',
    'chat_requests', 'whatsapp_events', 'sample_data_requests'
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
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM farms WHERE id = p_farm_id AND user_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.has_farm_role(p_farm_id UUID, p_roles TEXT[])
RETURNS BOOLEAN
LANGUAGE sql
STABLE
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

-- Direct Supabase clients receive the same read/write boundary as the API.
-- The API still performs its own role check because it intentionally uses the
-- service-role client for bounded, cross-table operations.
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

-- Ownership and the WhatsApp routing phone are server-managed. Without this
-- guard, "Editors update shared farms" would let an editor PATCH farms.user_id
-- through the REST API (making themselves owner), and any signed-in user could
-- claim another person's owner_phone. The API uses the service role, which keeps
-- full control; direct clients running as anon/authenticated do not.
CREATE OR REPLACE FUNCTION public.guard_farm_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.user_id := auth.uid();
    NEW.owner_phone := 'web-' || auth.uid();
  ELSIF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.owner_phone IS DISTINCT FROM OLD.owner_phone THEN
    RAISE EXCEPTION 'farm owner and phone can only be changed by the server'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_farm_identity() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_farm_identity ON farms;
CREATE TRIGGER guard_farm_identity
  BEFORE INSERT OR UPDATE ON farms
  FOR EACH ROW EXECUTE FUNCTION public.guard_farm_identity();

-- ═══════════════════════════════════════════════════════════════
-- 032_rescope_service_policies.sql
-- ═══════════════════════════════════════════════════════════════
-- 032: close the anon-key exposure left by the early setup scripts.
--
-- 002, 003, 004 and 005 created "Service role full access" policies as
-- `FOR ALL USING (true)` without `TO service_role`, which applies them to every
-- role, including `anon`. Because the anon key ships in the browser bundle, that
-- made every farm's rows readable and writable without signing in. The service
-- role bypasses RLS anyway, so scoping these policies loses the server nothing.
--
-- Standalone and re-runnable: it does not depend on 031 and can be applied before it.

DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN
    SELECT tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND policyname LIKE 'Service role full access%'
      AND roles <> '{service_role}'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', t.policyname, t.tablename);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
      t.policyname, t.tablename
    );
  END LOOP;
END $$;

-- The browser never queries tables directly (all data goes through the API with
-- the service role), so signed-out clients need no table access at all.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;

-- Trigger-only functions must not be callable through /rest/v1/rpc.
REVOKE EXECUTE ON FUNCTION public.log_field_mutation() FROM PUBLIC, anon, authenticated;
ALTER FUNCTION public.update_inventory_stock() SET search_path = public;

-- Fresh installs get both the 010 (5-arg) and 017 (6-arg) record_weight
-- overloads, which makes 5-argument calls ambiguous (PGRST203).
DROP FUNCTION IF EXISTS public.record_weight(UUID, UUID, DATE, NUMERIC, TEXT);

-- ═══════════════════════════════════════════════════════════════
-- 033_integrity_and_performance.sql
-- ═══════════════════════════════════════════════════════════════
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

-- ═══════════════════════════════════════════════════════════════
-- 034_drop_legacy_move_cattle_overload.sql
-- ═══════════════════════════════════════════════════════════════
-- CREATE OR REPLACE FUNCTION with an added parameter creates a new overload
-- instead of replacing the old one (signatures differ). The app always calls
-- move_cattle with all 5 named args (033 added p_idempotency_key), so the
-- old 4-arg overload is now dead and would only recreate the ambiguous-
-- overload class of bug 032 already fixed for record_weight.
DROP FUNCTION IF EXISTS public.move_cattle(uuid, uuid, uuid, integer);

-- ═══════════════════════════════════════════════════════════════
-- 035_fix_audit_trigger_farm_delete_cascade.sql
-- ═══════════════════════════════════════════════════════════════
-- Fixes a real bug: DELETE FROM farms on a farm with any audited child rows
-- (cattle, sections, ...) failed with a foreign key violation, because
-- log_field_mutation() unconditionally inserted an activities row on every
-- child DELETE -- including ones fired by the cascade from the farm's own
-- deletion, by which point farms.id no longer exists. This is exactly the
-- sample-data rollback path (api/sample-data/route.ts deletes the farm to
-- undo a partial create on error), so a failed sample-data generation with
-- any cattle/sections already created could not be cleaned up.
-- Repro'd and fix verified via BEGIN/ROLLBACK against live data before
-- applying.
CREATE OR REPLACE FUNCTION public.log_field_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_farm_id uuid;
  v_id uuid;
  v_action text := lower(TG_OP);
BEGIN
  IF TG_TABLE_NAME = 'activities' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  v_farm_id := COALESCE(NEW.farm_id, OLD.farm_id);
  v_id := COALESCE(NEW.id, OLD.id);
  IF v_farm_id IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM farms WHERE id = v_farm_id) THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  INSERT INTO public.activities (farm_id, type, description, message_type, metadata)
  VALUES (
    v_farm_id,
    'registration',
    format('%s %s (%s)', initcap(v_action), replace(TG_TABLE_NAME, '_', ' '), v_id),
    'text',
    jsonb_build_object('table', TG_TABLE_NAME, 'action', v_action, 'record_id', v_id)
  );

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$function$;

-- ═══════════════════════════════════════════════════════════════
-- 036_rate_limit_buckets.sql
-- ═══════════════════════════════════════════════════════════════
-- Replaces the in-memory per-serverless-instance rate limiter (rate-limit.ts)
-- with a shared, atomic token bucket in Postgres. The in-memory Map reset on
-- every cold start and was never shared across instances, so the real limit
-- was N-instances times higher than configured.
CREATE TABLE IF NOT EXISTS public.rate_limit_buckets (
  key TEXT PRIMARY KEY,
  tokens DOUBLE PRECISION NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.rate_limit_buckets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access" ON public.rate_limit_buckets;
CREATE POLICY "Service role full access" ON public.rate_limit_buckets
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.consume_rate_limit_token(
  p_key TEXT,
  p_capacity DOUBLE PRECISION,
  p_refill_per_sec DOUBLE PRECISION
)
RETURNS TABLE(allowed BOOLEAN, retry_after_sec INTEGER)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_tokens DOUBLE PRECISION;
  v_updated TIMESTAMPTZ;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_elapsed_sec DOUBLE PRECISION;
BEGIN
  INSERT INTO rate_limit_buckets (key, tokens, updated_at)
  VALUES (p_key, p_capacity, v_now)
  ON CONFLICT (key) DO NOTHING;

  SELECT b.tokens, b.updated_at INTO v_tokens, v_updated
  FROM rate_limit_buckets b WHERE b.key = p_key FOR UPDATE;

  v_elapsed_sec := GREATEST(0, EXTRACT(EPOCH FROM (v_now - v_updated)));
  v_tokens := LEAST(p_capacity, v_tokens + v_elapsed_sec * p_refill_per_sec);

  IF v_tokens >= 1 THEN
    v_tokens := v_tokens - 1;
    UPDATE rate_limit_buckets SET tokens = v_tokens, updated_at = v_now WHERE key = p_key;
    RETURN QUERY SELECT true, 0;
  ELSE
    UPDATE rate_limit_buckets SET tokens = v_tokens, updated_at = v_now WHERE key = p_key;
    RETURN QUERY SELECT false, CEIL((1 - v_tokens) / p_refill_per_sec)::INTEGER;
  END IF;
END;
$function$;

-- ═══════════════════════════════════════════════════════════════
-- 037_chat_messages_author_role.sql
-- ═══════════════════════════════════════════════════════════════
-- Tag chat_messages with the farm role of whoever sent it, so a viewer's
-- turn can be dropped from the shared transcript an editor's AI calls read.
-- Viewers are read-only but a shared chat_messages transcript previously fed
-- every message, from any role, into readSharedChatHistory for every
-- channel -- a viewer could type a destructive-sounding instruction and have
-- it sit in the history an editor's later AI call reads as context.
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS author_role TEXT;

-- ═══════════════════════════════════════════════════════════════
-- 038_wrap_auth_uid_in_policies.sql
-- ═══════════════════════════════════════════════════════════════
-- Wraps every bare auth.uid() call in RLS USING/WITH CHECK clauses as
-- (select auth.uid()) across the 24 policies the performance advisor flagged
-- (auth_rls_initplan). This is a pure query-plan optimization, not an access-
-- control change: (select auth.uid()) evaluates to the exact same value as
-- auth.uid(), it just lets Postgres cache it once per query (an InitPlan)
-- instead of re-evaluating it once per row. Generated from pg_policies and
-- verified with a dry run (BEGIN...ROLLBACK) before applying.

DROP POLICY "Users manage own activities" ON public.activities;
CREATE POLICY "Users manage own activities" ON public.activities AS PERMISSIVE FOR ALL TO public USING ((farm_id IN ( SELECT farms.id
   FROM farms
  WHERE (farms.user_id = (select auth.uid())))));

DROP POLICY "Users read own activities" ON public.activities;
CREATE POLICY "Users read own activities" ON public.activities AS PERMISSIVE FOR SELECT TO public USING ((farm_id IN ( SELECT farms.id
   FROM farms
  WHERE (farms.user_id = (select auth.uid())))));

DROP POLICY "Users manage own cattle" ON public.cattle;
CREATE POLICY "Users manage own cattle" ON public.cattle AS PERMISSIVE FOR ALL TO public USING ((farm_id IN ( SELECT farms.id
   FROM farms
  WHERE (farms.user_id = (select auth.uid())))));

DROP POLICY "Users read own cattle" ON public.cattle;
CREATE POLICY "Users read own cattle" ON public.cattle AS PERMISSIVE FOR SELECT TO public USING ((farm_id IN ( SELECT farms.id
   FROM farms
  WHERE (farms.user_id = (select auth.uid())))));

DROP POLICY "Users manage own chat messages" ON public.chat_messages;
CREATE POLICY "Users manage own chat messages" ON public.chat_messages AS PERMISSIVE FOR ALL TO public USING ((farm_id IN ( SELECT farms.id
   FROM farms
  WHERE (farms.user_id = (select auth.uid())))));

DROP POLICY "Users manage own chat requests" ON public.chat_requests;
CREATE POLICY "Users manage own chat requests" ON public.chat_requests AS PERMISSIVE FOR ALL TO public USING ((farm_id IN ( SELECT farms.id
   FROM farms
  WHERE (farms.user_id = (select auth.uid())))));

DROP POLICY "Users access own crop_applications" ON public.crop_applications;
CREATE POLICY "Users access own crop_applications" ON public.crop_applications AS PERMISSIVE FOR ALL TO authenticated USING ((farm_id IN ( SELECT farms.id
   FROM farms
  WHERE (farms.user_id = (select auth.uid()))))) WITH CHECK ((farm_id IN ( SELECT farms.id
   FROM farms
  WHERE (farms.user_id = (select auth.uid())))));

DROP POLICY "Users access own crops" ON public.crops;
CREATE POLICY "Users access own crops" ON public.crops AS PERMISSIVE FOR ALL TO authenticated USING ((farm_id IN ( SELECT farms.id
   FROM farms
  WHERE (farms.user_id = (select auth.uid()))))) WITH CHECK ((farm_id IN ( SELECT farms.id
   FROM farms
  WHERE (farms.user_id = (select auth.uid())))));

DROP POLICY "Users access own farm_insights" ON public.farm_insights;
CREATE POLICY "Users access own farm_insights" ON public.farm_insights AS PERMISSIVE FOR ALL TO authenticated USING ((farm_id IN ( SELECT farms.id
   FROM farms
  WHERE (farms.user_id = (select auth.uid()))))) WITH CHECK ((farm_id IN ( SELECT farms.id
   FROM farms
  WHERE (farms.user_id = (select auth.uid())))));

DROP POLICY "Members read farm memberships" ON public.farm_members;
CREATE POLICY "Members read farm memberships" ON public.farm_members AS PERMISSIVE FOR SELECT TO public USING (((user_id = (select auth.uid())) OR is_farm_owner(farm_id)));

DROP POLICY "Users read own farms" ON public.farms;
CREATE POLICY "Users read own farms" ON public.farms AS PERMISSIVE FOR SELECT TO public USING (((select auth.uid()) = user_id));

DROP POLICY "Users update own farms" ON public.farms;
CREATE POLICY "Users update own farms" ON public.farms AS PERMISSIVE FOR UPDATE TO public USING (((select auth.uid()) = user_id));

DROP POLICY "Users access own financial_transactions" ON public.financial_transactions;
CREATE POLICY "Users access own financial_transactions" ON public.financial_transactions AS PERMISSIVE FOR ALL TO authenticated USING ((farm_id IN ( SELECT farms.id
   FROM farms
  WHERE (farms.user_id = (select auth.uid()))))) WITH CHECK ((farm_id IN ( SELECT farms.id
   FROM farms
  WHERE (farms.user_id = (select auth.uid())))));

DROP POLICY "Users manage own health events" ON public.health_events;
CREATE POLICY "Users manage own health events" ON public.health_events AS PERMISSIVE FOR ALL TO public USING ((farm_id IN ( SELECT farms.id
   FROM farms
  WHERE (farms.user_id = (select auth.uid())))));

DROP POLICY "Users access own inventory_items" ON public.inventory_items;
CREATE POLICY "Users access own inventory_items" ON public.inventory_items AS PERMISSIVE FOR ALL TO authenticated USING ((farm_id IN ( SELECT farms.id
   FROM farms
  WHERE (farms.user_id = (select auth.uid()))))) WITH CHECK ((farm_id IN ( SELECT farms.id
   FROM farms
  WHERE (farms.user_id = (select auth.uid())))));

DROP POLICY "Users access own inventory_movements" ON public.inventory_movements;
CREATE POLICY "Users access own inventory_movements" ON public.inventory_movements AS PERMISSIVE FOR ALL TO authenticated USING ((farm_id IN ( SELECT farms.id
   FROM farms
  WHERE (farms.user_id = (select auth.uid()))))) WITH CHECK ((farm_id IN ( SELECT farms.id
   FROM farms
  WHERE (farms.user_id = (select auth.uid())))));

DROP POLICY "Users manage own map features" ON public.map_features;
CREATE POLICY "Users manage own map features" ON public.map_features AS PERMISSIVE FOR ALL TO public USING ((farm_id IN ( SELECT farms.id
   FROM farms
  WHERE (farms.user_id = (select auth.uid())))));

DROP POLICY "Users manage own padrones" ON public.padrones;
CREATE POLICY "Users manage own padrones" ON public.padrones AS PERMISSIVE FOR ALL TO public USING ((farm_id IN ( SELECT farms.id
   FROM farms
  WHERE (farms.user_id = (select auth.uid())))));

DROP POLICY "Users manage own sample data requests" ON public.sample_data_requests;
CREATE POLICY "Users manage own sample data requests" ON public.sample_data_requests AS PERMISSIVE FOR ALL TO public USING ((user_id = (select auth.uid())));

DROP POLICY "Users manage own sections" ON public.sections;
CREATE POLICY "Users manage own sections" ON public.sections AS PERMISSIVE FOR ALL TO public USING ((farm_id IN ( SELECT farms.id
   FROM farms
  WHERE (farms.user_id = (select auth.uid())))));

DROP POLICY "Users read own sections" ON public.sections;
CREATE POLICY "Users read own sections" ON public.sections AS PERMISSIVE FOR SELECT TO public USING ((farm_id IN ( SELECT farms.id
   FROM farms
  WHERE (farms.user_id = (select auth.uid())))));

DROP POLICY "Users access own tasks" ON public.tasks;
CREATE POLICY "Users access own tasks" ON public.tasks AS PERMISSIVE FOR ALL TO authenticated USING ((farm_id IN ( SELECT farms.id
   FROM farms
  WHERE (farms.user_id = (select auth.uid()))))) WITH CHECK ((farm_id IN ( SELECT farms.id
   FROM farms
  WHERE (farms.user_id = (select auth.uid())))));

DROP POLICY "Users manage own vaccinations" ON public.vaccinations;
CREATE POLICY "Users manage own vaccinations" ON public.vaccinations AS PERMISSIVE FOR ALL TO public USING ((farm_id IN ( SELECT farms.id
   FROM farms
  WHERE (farms.user_id = (select auth.uid())))));

DROP POLICY "Users access own weight_records" ON public.weight_records;
CREATE POLICY "Users access own weight_records" ON public.weight_records AS PERMISSIVE FOR ALL TO authenticated USING ((farm_id IN ( SELECT farms.id
   FROM farms
  WHERE (farms.user_id = (select auth.uid()))))) WITH CHECK ((farm_id IN ( SELECT farms.id
   FROM farms
  WHERE (farms.user_id = (select auth.uid())))));

-- ═══════════════════════════════════════════════════════════════
-- 039_wrap_auth_uid_farms_insert_policy.sql
-- ═══════════════════════════════════════════════════════════════
-- Follow-up to 038: "Users insert own farms" is an INSERT-only policy (no
-- USING clause, only WITH CHECK), so it was excluded by a NULL-handling bug
-- in the query that generated 038's DROP/CREATE list (qual IS NULL for a
-- pure INSERT policy made the WHERE clause evaluate to NULL for that row).
DROP POLICY "Users insert own farms" ON public.farms;
CREATE POLICY "Users insert own farms" ON public.farms AS PERMISSIVE FOR INSERT TO public WITH CHECK (((select auth.uid()) = user_id));

-- ═══════════════════════════════════════════════════════════════
-- 040_retention_whatsapp_events_chat_requests.sql
-- ═══════════════════════════════════════════════════════════════
-- 30-day retention for whatsapp_events and chat_requests, per the audit's
-- storage-budget concern (500 MB free tier). Both tables are pure
-- operational/idempotency bookkeeping (webhook dedupe and retry-safety
-- records) with no long-term value once a request has resolved and its
-- retry window (10 minutes, per AI_CONFIRMATION_TTL_MS) has long passed.
CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION public.purge_operational_retention_rows()
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM whatsapp_events WHERE updated_at < now() - interval '30 days';
  DELETE FROM chat_requests WHERE updated_at < now() - interval '30 days';
END;
$function$;

SELECT cron.schedule(
  'purge-operational-retention-rows',
  '0 3 * * *',
  $$SELECT public.purge_operational_retention_rows();$$
);

-- ═══════════════════════════════════════════════════════════════
-- 041_drop_redundant_own_policies.sql
-- ═══════════════════════════════════════════════════════════════
-- Drops the pre-031 "own farm" policies (farms.user_id = auth.uid()) that
-- migration 031's "shared farm" policies (has_farm_role(...)) now fully
-- subsume: every farm's owner is backfilled into farm_members with
-- role='owner' (verified: 0 of 5 farms missing that row), and new farm
-- creation inserts the owner's membership row atomically (api/farm/route.ts
-- POST), so has_farm_role(farm_id, ARRAY['owner','editor']) is true
-- whenever farms.user_id = auth.uid() would have been, plus it correctly
-- extends the same access to editors (and viewers for SELECT). Having both
-- policies live side by side is exactly the multiple_permissive_policies
-- (259) the performance advisor flags -- Postgres evaluates and ORs every
-- permissive policy on every query. farms.user_id itself, and "Users insert
-- own farms" (no shared equivalent -- farm creation isn't a shared action),
-- are untouched.
-- Verified via a dry run (BEGIN...ROLLBACK): every affected table retains
-- exactly one non-service-role policy per command after these drops.

DROP POLICY IF EXISTS "Users manage own activities" ON public.activities;
DROP POLICY IF EXISTS "Users read own activities" ON public.activities;
DROP POLICY IF EXISTS "Users manage own cattle" ON public.cattle;
DROP POLICY IF EXISTS "Users read own cattle" ON public.cattle;
DROP POLICY IF EXISTS "Users manage own chat messages" ON public.chat_messages;
DROP POLICY IF EXISTS "Users manage own chat requests" ON public.chat_requests;
DROP POLICY IF EXISTS "Users access own crop_applications" ON public.crop_applications;
DROP POLICY IF EXISTS "Users access own crops" ON public.crops;
DROP POLICY IF EXISTS "Users access own farm_insights" ON public.farm_insights;
DROP POLICY IF EXISTS "Users access own financial_transactions" ON public.financial_transactions;
DROP POLICY IF EXISTS "Users manage own health events" ON public.health_events;
DROP POLICY IF EXISTS "Users access own inventory_items" ON public.inventory_items;
DROP POLICY IF EXISTS "Users access own inventory_movements" ON public.inventory_movements;
DROP POLICY IF EXISTS "Users manage own map features" ON public.map_features;
DROP POLICY IF EXISTS "Users manage own padrones" ON public.padrones;
DROP POLICY IF EXISTS "Users manage own sections" ON public.sections;
DROP POLICY IF EXISTS "Users read own sections" ON public.sections;
DROP POLICY IF EXISTS "Users access own tasks" ON public.tasks;
DROP POLICY IF EXISTS "Users manage own vaccinations" ON public.vaccinations;
DROP POLICY IF EXISTS "Users access own weight_records" ON public.weight_records;
DROP POLICY IF EXISTS "Users read own farms" ON public.farms;
DROP POLICY IF EXISTS "Users update own farms" ON public.farms;

-- ═══════════════════════════════════════════════════════════════
-- 042_split_editor_all_policies.sql
-- ═══════════════════════════════════════════════════════════════
-- Second half of the multiple_permissive_policies (advisor WARN) cleanup.
-- 041 dropped the pre-031 "own" policies that were fully subsumed by 031's
-- shared-farm policies; this migration addresses the remaining overlap
-- flagged by the advisor: each table's own "Editors manage shared X" policy
-- is FOR ALL (USING/WITH CHECK: has_farm_role(farm_id, ARRAY['owner',
-- 'editor'])), which implicitly includes SELECT -- redundant with, and
-- evaluated alongside, "Members read shared X" for every SELECT query
-- (both permissive, both OR'd in). Splitting the ALL policy into INSERT/
-- UPDATE/DELETE-only policies with the identical USING/WITH CHECK
-- expression preserves editor/owner write access exactly as before (their
-- SELECT access continues to come from "Members read shared X", which
-- already covers owner/editor/viewer), while eliminating the SELECT-path
-- overlap. Same pattern applied to farm_members' "Owners manage farm
-- memberships" vs "Members read farm memberships".
-- Verified via a dry run (BEGIN...ROLLBACK): every affected table retains
-- exactly one policy per command (SELECT/INSERT/UPDATE/DELETE) afterward.

DROP POLICY IF EXISTS "Editors manage shared activities" ON public.activities;
DROP POLICY IF EXISTS "Editors insert shared activities" ON public.activities;
CREATE POLICY "Editors insert shared activities" ON public.activities FOR INSERT TO public WITH CHECK (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
DROP POLICY IF EXISTS "Editors update shared activities" ON public.activities;
CREATE POLICY "Editors update shared activities" ON public.activities FOR UPDATE TO public USING (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text])) WITH CHECK (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
DROP POLICY IF EXISTS "Editors delete shared activities" ON public.activities;
CREATE POLICY "Editors delete shared activities" ON public.activities FOR DELETE TO public USING (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));

DROP POLICY IF EXISTS "Editors manage shared cattle" ON public.cattle;
DROP POLICY IF EXISTS "Editors insert shared cattle" ON public.cattle;
CREATE POLICY "Editors insert shared cattle" ON public.cattle FOR INSERT TO public WITH CHECK (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
DROP POLICY IF EXISTS "Editors update shared cattle" ON public.cattle;
CREATE POLICY "Editors update shared cattle" ON public.cattle FOR UPDATE TO public USING (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text])) WITH CHECK (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
DROP POLICY IF EXISTS "Editors delete shared cattle" ON public.cattle;
CREATE POLICY "Editors delete shared cattle" ON public.cattle FOR DELETE TO public USING (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));

DROP POLICY IF EXISTS "Editors manage shared chat_messages" ON public.chat_messages;
DROP POLICY IF EXISTS "Editors insert shared chat_messages" ON public.chat_messages;
CREATE POLICY "Editors insert shared chat_messages" ON public.chat_messages FOR INSERT TO public WITH CHECK (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
DROP POLICY IF EXISTS "Editors update shared chat_messages" ON public.chat_messages;
CREATE POLICY "Editors update shared chat_messages" ON public.chat_messages FOR UPDATE TO public USING (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text])) WITH CHECK (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
DROP POLICY IF EXISTS "Editors delete shared chat_messages" ON public.chat_messages;
CREATE POLICY "Editors delete shared chat_messages" ON public.chat_messages FOR DELETE TO public USING (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));

DROP POLICY IF EXISTS "Editors manage shared chat_requests" ON public.chat_requests;
DROP POLICY IF EXISTS "Editors insert shared chat_requests" ON public.chat_requests;
CREATE POLICY "Editors insert shared chat_requests" ON public.chat_requests FOR INSERT TO public WITH CHECK (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
DROP POLICY IF EXISTS "Editors update shared chat_requests" ON public.chat_requests;
CREATE POLICY "Editors update shared chat_requests" ON public.chat_requests FOR UPDATE TO public USING (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text])) WITH CHECK (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
DROP POLICY IF EXISTS "Editors delete shared chat_requests" ON public.chat_requests;
CREATE POLICY "Editors delete shared chat_requests" ON public.chat_requests FOR DELETE TO public USING (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));

DROP POLICY IF EXISTS "Editors manage shared crop_applications" ON public.crop_applications;
DROP POLICY IF EXISTS "Editors insert shared crop_applications" ON public.crop_applications;
CREATE POLICY "Editors insert shared crop_applications" ON public.crop_applications FOR INSERT TO public WITH CHECK (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
DROP POLICY IF EXISTS "Editors update shared crop_applications" ON public.crop_applications;
CREATE POLICY "Editors update shared crop_applications" ON public.crop_applications FOR UPDATE TO public USING (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text])) WITH CHECK (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
DROP POLICY IF EXISTS "Editors delete shared crop_applications" ON public.crop_applications;
CREATE POLICY "Editors delete shared crop_applications" ON public.crop_applications FOR DELETE TO public USING (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));

DROP POLICY IF EXISTS "Editors manage shared crops" ON public.crops;
DROP POLICY IF EXISTS "Editors insert shared crops" ON public.crops;
CREATE POLICY "Editors insert shared crops" ON public.crops FOR INSERT TO public WITH CHECK (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
DROP POLICY IF EXISTS "Editors update shared crops" ON public.crops;
CREATE POLICY "Editors update shared crops" ON public.crops FOR UPDATE TO public USING (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text])) WITH CHECK (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
DROP POLICY IF EXISTS "Editors delete shared crops" ON public.crops;
CREATE POLICY "Editors delete shared crops" ON public.crops FOR DELETE TO public USING (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));

DROP POLICY IF EXISTS "Editors manage shared farm_insights" ON public.farm_insights;
DROP POLICY IF EXISTS "Editors insert shared farm_insights" ON public.farm_insights;
CREATE POLICY "Editors insert shared farm_insights" ON public.farm_insights FOR INSERT TO public WITH CHECK (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
DROP POLICY IF EXISTS "Editors update shared farm_insights" ON public.farm_insights;
CREATE POLICY "Editors update shared farm_insights" ON public.farm_insights FOR UPDATE TO public USING (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text])) WITH CHECK (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
DROP POLICY IF EXISTS "Editors delete shared farm_insights" ON public.farm_insights;
CREATE POLICY "Editors delete shared farm_insights" ON public.farm_insights FOR DELETE TO public USING (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));

DROP POLICY IF EXISTS "Owners manage farm memberships" ON public.farm_members;
DROP POLICY IF EXISTS "Owners insert farm memberships" ON public.farm_members;
CREATE POLICY "Owners insert farm memberships" ON public.farm_members FOR INSERT TO public WITH CHECK (is_farm_owner(farm_id));
DROP POLICY IF EXISTS "Owners update farm memberships" ON public.farm_members;
CREATE POLICY "Owners update farm memberships" ON public.farm_members FOR UPDATE TO public USING (is_farm_owner(farm_id)) WITH CHECK (is_farm_owner(farm_id));
DROP POLICY IF EXISTS "Owners delete farm memberships" ON public.farm_members;
CREATE POLICY "Owners delete farm memberships" ON public.farm_members FOR DELETE TO public USING (is_farm_owner(farm_id));

DROP POLICY IF EXISTS "Editors manage shared financial_transactions" ON public.financial_transactions;
DROP POLICY IF EXISTS "Editors insert shared financial_transactions" ON public.financial_transactions;
CREATE POLICY "Editors insert shared financial_transactions" ON public.financial_transactions FOR INSERT TO public WITH CHECK (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
DROP POLICY IF EXISTS "Editors update shared financial_transactions" ON public.financial_transactions;
CREATE POLICY "Editors update shared financial_transactions" ON public.financial_transactions FOR UPDATE TO public USING (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text])) WITH CHECK (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
DROP POLICY IF EXISTS "Editors delete shared financial_transactions" ON public.financial_transactions;
CREATE POLICY "Editors delete shared financial_transactions" ON public.financial_transactions FOR DELETE TO public USING (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));

DROP POLICY IF EXISTS "Editors manage shared health_events" ON public.health_events;
DROP POLICY IF EXISTS "Editors insert shared health_events" ON public.health_events;
CREATE POLICY "Editors insert shared health_events" ON public.health_events FOR INSERT TO public WITH CHECK (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
DROP POLICY IF EXISTS "Editors update shared health_events" ON public.health_events;
CREATE POLICY "Editors update shared health_events" ON public.health_events FOR UPDATE TO public USING (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text])) WITH CHECK (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
DROP POLICY IF EXISTS "Editors delete shared health_events" ON public.health_events;
CREATE POLICY "Editors delete shared health_events" ON public.health_events FOR DELETE TO public USING (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));

DROP POLICY IF EXISTS "Editors manage shared inventory_items" ON public.inventory_items;
DROP POLICY IF EXISTS "Editors insert shared inventory_items" ON public.inventory_items;
CREATE POLICY "Editors insert shared inventory_items" ON public.inventory_items FOR INSERT TO public WITH CHECK (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
DROP POLICY IF EXISTS "Editors update shared inventory_items" ON public.inventory_items;
CREATE POLICY "Editors update shared inventory_items" ON public.inventory_items FOR UPDATE TO public USING (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text])) WITH CHECK (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
DROP POLICY IF EXISTS "Editors delete shared inventory_items" ON public.inventory_items;
CREATE POLICY "Editors delete shared inventory_items" ON public.inventory_items FOR DELETE TO public USING (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));

DROP POLICY IF EXISTS "Editors manage shared inventory_movements" ON public.inventory_movements;
DROP POLICY IF EXISTS "Editors insert shared inventory_movements" ON public.inventory_movements;
CREATE POLICY "Editors insert shared inventory_movements" ON public.inventory_movements FOR INSERT TO public WITH CHECK (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
DROP POLICY IF EXISTS "Editors update shared inventory_movements" ON public.inventory_movements;
CREATE POLICY "Editors update shared inventory_movements" ON public.inventory_movements FOR UPDATE TO public USING (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text])) WITH CHECK (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
DROP POLICY IF EXISTS "Editors delete shared inventory_movements" ON public.inventory_movements;
CREATE POLICY "Editors delete shared inventory_movements" ON public.inventory_movements FOR DELETE TO public USING (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));

DROP POLICY IF EXISTS "Editors manage shared map_features" ON public.map_features;
DROP POLICY IF EXISTS "Editors insert shared map_features" ON public.map_features;
CREATE POLICY "Editors insert shared map_features" ON public.map_features FOR INSERT TO public WITH CHECK (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
DROP POLICY IF EXISTS "Editors update shared map_features" ON public.map_features;
CREATE POLICY "Editors update shared map_features" ON public.map_features FOR UPDATE TO public USING (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text])) WITH CHECK (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
DROP POLICY IF EXISTS "Editors delete shared map_features" ON public.map_features;
CREATE POLICY "Editors delete shared map_features" ON public.map_features FOR DELETE TO public USING (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));

DROP POLICY IF EXISTS "Editors manage shared padrones" ON public.padrones;
DROP POLICY IF EXISTS "Editors insert shared padrones" ON public.padrones;
CREATE POLICY "Editors insert shared padrones" ON public.padrones FOR INSERT TO public WITH CHECK (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
DROP POLICY IF EXISTS "Editors update shared padrones" ON public.padrones;
CREATE POLICY "Editors update shared padrones" ON public.padrones FOR UPDATE TO public USING (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text])) WITH CHECK (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
DROP POLICY IF EXISTS "Editors delete shared padrones" ON public.padrones;
CREATE POLICY "Editors delete shared padrones" ON public.padrones FOR DELETE TO public USING (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));

DROP POLICY IF EXISTS "Editors manage shared sections" ON public.sections;
DROP POLICY IF EXISTS "Editors insert shared sections" ON public.sections;
CREATE POLICY "Editors insert shared sections" ON public.sections FOR INSERT TO public WITH CHECK (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
DROP POLICY IF EXISTS "Editors update shared sections" ON public.sections;
CREATE POLICY "Editors update shared sections" ON public.sections FOR UPDATE TO public USING (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text])) WITH CHECK (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
DROP POLICY IF EXISTS "Editors delete shared sections" ON public.sections;
CREATE POLICY "Editors delete shared sections" ON public.sections FOR DELETE TO public USING (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));

DROP POLICY IF EXISTS "Editors manage shared tasks" ON public.tasks;
DROP POLICY IF EXISTS "Editors insert shared tasks" ON public.tasks;
CREATE POLICY "Editors insert shared tasks" ON public.tasks FOR INSERT TO public WITH CHECK (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
DROP POLICY IF EXISTS "Editors update shared tasks" ON public.tasks;
CREATE POLICY "Editors update shared tasks" ON public.tasks FOR UPDATE TO public USING (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text])) WITH CHECK (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
DROP POLICY IF EXISTS "Editors delete shared tasks" ON public.tasks;
CREATE POLICY "Editors delete shared tasks" ON public.tasks FOR DELETE TO public USING (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));

DROP POLICY IF EXISTS "Editors manage shared vaccinations" ON public.vaccinations;
DROP POLICY IF EXISTS "Editors insert shared vaccinations" ON public.vaccinations;
CREATE POLICY "Editors insert shared vaccinations" ON public.vaccinations FOR INSERT TO public WITH CHECK (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
DROP POLICY IF EXISTS "Editors update shared vaccinations" ON public.vaccinations;
CREATE POLICY "Editors update shared vaccinations" ON public.vaccinations FOR UPDATE TO public USING (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text])) WITH CHECK (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
DROP POLICY IF EXISTS "Editors delete shared vaccinations" ON public.vaccinations;
CREATE POLICY "Editors delete shared vaccinations" ON public.vaccinations FOR DELETE TO public USING (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));

DROP POLICY IF EXISTS "Editors manage shared weight_records" ON public.weight_records;
DROP POLICY IF EXISTS "Editors insert shared weight_records" ON public.weight_records;
CREATE POLICY "Editors insert shared weight_records" ON public.weight_records FOR INSERT TO public WITH CHECK (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
DROP POLICY IF EXISTS "Editors update shared weight_records" ON public.weight_records;
CREATE POLICY "Editors update shared weight_records" ON public.weight_records FOR UPDATE TO public USING (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text])) WITH CHECK (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));
DROP POLICY IF EXISTS "Editors delete shared weight_records" ON public.weight_records;
CREATE POLICY "Editors delete shared weight_records" ON public.weight_records FOR DELETE TO public USING (has_farm_role(farm_id, ARRAY['owner'::text, 'editor'::text]));

-- ═══════════════════════════════════════════════════════════════
-- 043_updated_at_triggers_for_ai_mutable_tables.sql
-- ═══════════════════════════════════════════════════════════════
-- Foundation for binding AI confirmation tokens to each target row's
-- updated_at (optimistic concurrency -- GOAL-audit-2026-09.md's "Bind
-- confirmation tokens to userId and each target row's updated_at").
-- Discovered while starting that work: only cattle and tasks (of the 10
-- AI update/delete-reachable tables -- inventory_movements and
-- weight_records are insert-only in executeOperations) had an updated_at
-- column at all, and even those two relied on API routes manually setting
-- it (cattle/route.ts:232, tasks/route.ts:194); the AI write path strips
-- any updated_at the model sends (ai.ts:982) and never re-sets it, so
-- every AI-driven update to cattle/tasks has been leaving updated_at
-- stale since the AI path shipped. A DB-level BEFORE UPDATE trigger fixes
-- that independently of the confirmation-binding work, and is required by
-- it: a reliable, DB-enforced updated_at is what "expected value changed"
-- detection anchors on. log_field_mutation() (035) logs one row-level
-- activity per mutation, not per changed column, so this doesn't add
-- history-feed noise.

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

ALTER TABLE public.sections ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.vaccinations ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.health_events ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.crops ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.crop_applications ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.inventory_items ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.financial_transactions ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS set_updated_at_sections ON public.sections;
CREATE TRIGGER set_updated_at_sections BEFORE UPDATE ON public.sections FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS set_updated_at_cattle ON public.cattle;
CREATE TRIGGER set_updated_at_cattle BEFORE UPDATE ON public.cattle FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS set_updated_at_activities ON public.activities;
CREATE TRIGGER set_updated_at_activities BEFORE UPDATE ON public.activities FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS set_updated_at_vaccinations ON public.vaccinations;
CREATE TRIGGER set_updated_at_vaccinations BEFORE UPDATE ON public.vaccinations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS set_updated_at_health_events ON public.health_events;
CREATE TRIGGER set_updated_at_health_events BEFORE UPDATE ON public.health_events FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS set_updated_at_crops ON public.crops;
CREATE TRIGGER set_updated_at_crops BEFORE UPDATE ON public.crops FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS set_updated_at_crop_applications ON public.crop_applications;
CREATE TRIGGER set_updated_at_crop_applications BEFORE UPDATE ON public.crop_applications FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS set_updated_at_inventory_items ON public.inventory_items;
CREATE TRIGGER set_updated_at_inventory_items BEFORE UPDATE ON public.inventory_items FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS set_updated_at_financial_transactions ON public.financial_transactions;
CREATE TRIGGER set_updated_at_financial_transactions BEFORE UPDATE ON public.financial_transactions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS set_updated_at_tasks ON public.tasks;
CREATE TRIGGER set_updated_at_tasks BEFORE UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════
-- 044_ai_confirmed_requests.sql
-- ═══════════════════════════════════════════════════════════════
-- Completes GOAL-audit-2026-09.md's confirmation-token binding item: a
-- confirmed AI write proposal's requestId must never be re-executed, but
-- the existing single-use guard (chat_requests, keyed by farm_id+request_id
-- via claim/complete) is deleted along with chat_messages whenever the user
-- clicks "Limpiar historial" in the chat UI. Within the confirmation
-- token's 10-minute TTL, that silently re-enables replay: verifyAIConfirmation
-- only checks the token's signature/expiry/farm/subject, not whether it was
-- already applied. This table is a separate, minimal consumption record
-- that "Limpiar historial" never touches (it only deletes chat_messages and
-- chat_requests), so a confirmed proposal stays single-use for its whole
-- signed lifetime regardless of history clearing.
CREATE TABLE IF NOT EXISTS public.ai_confirmed_requests (
  request_id TEXT PRIMARY KEY,
  farm_id UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_confirmed_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access" ON public.ai_confirmed_requests;
CREATE POLICY "Service role full access" ON public.ai_confirmed_requests
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Extend 040's daily purge job to also clean this table. A 1-day window is
-- generous given the signed token itself expires after 10 minutes -- rows
-- here are never useful past that, this just avoids unbounded growth.
CREATE OR REPLACE FUNCTION public.purge_operational_retention_rows()
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM whatsapp_events WHERE updated_at < now() - interval '30 days';
  DELETE FROM chat_requests WHERE updated_at < now() - interval '30 days';
  DELETE FROM ai_confirmed_requests WHERE confirmed_at < now() - interval '1 day';
END;
$function$;

-- ═══════════════════════════════════════════════════════════════
-- 045_section_occupancy.sql
-- ═══════════════════════════════════════════════════════════════
-- GOAL-field-ops.md B: the grazing/rest clock per potrero.
--
-- move_cattle and every other cattle write rewrite cattle.section_id in
-- place, so nothing records when a potrero was stocked or emptied, and days
-- grazed / days rested (the basis of any rotation) are unknowable. A trigger
-- on cattle keeps that clock for every write path at once: the UI routes,
-- the AI executor, move_cattle, CSV import and sample data.
--
-- It lives in its own table rather than on sections because sections has a
-- BEFORE UPDATE updated_at trigger (043) that anchors the AI confirmation's
-- optimistic-concurrency check, and an audit trigger (012) that logs every
-- update. Stamping sections on each move would invalidate pending AI
-- proposals about that potrero and flood the activity feed.
--
-- The clock moves only on a real transition. A potrero that already held
-- animals when this shipped has no row (start unknown) until it is emptied;
-- any inferred date would be a guess shown as fact.
CREATE TABLE IF NOT EXISTS public.section_occupancy (
  section_id UUID PRIMARY KEY REFERENCES public.sections(id) ON DELETE CASCADE,
  farm_id UUID NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  occupied_since TIMESTAMPTZ,
  last_vacated_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_section_occupancy_farm ON public.section_occupancy(farm_id);

ALTER TABLE public.section_occupancy ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access" ON public.section_occupancy;
CREATE POLICY "Service role full access" ON public.section_occupancy
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- p_arrived / p_departed: heads that entered or left this section in the
-- triggering row change. The clock moves only on a real transition: the
-- section was empty before these arrivals, or is empty after these
-- departures. Touching a zero-count row in a resting potrero changes nothing.
--
-- SECURITY DEFINER with a fixed search_path, mirroring log_field_mutation
-- (012/035): the trigger must write this service-role-only table whichever
-- role wrote cattle. Execution is revoked from every API role below.
CREATE OR REPLACE FUNCTION public.refresh_section_occupancy(p_section_id UUID, p_arrived INTEGER, p_departed INTEGER)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_farm_id UUID;
  v_heads BIGINT;
BEGIN
  IF p_section_id IS NULL THEN
    RETURN;
  END IF;
  -- Missing when the section itself is being deleted (cascade).
  SELECT farm_id INTO v_farm_id FROM public.sections WHERE id = p_section_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  -- Same guard as 035: during DELETE FROM farms the cascade can reach cattle
  -- before sections, and inserting a row for a deleted farm would abort it.
  IF NOT EXISTS (SELECT 1 FROM public.farms WHERE id = v_farm_id) THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(count), 0) INTO v_heads
  FROM public.cattle
  WHERE section_id = p_section_id AND count > 0;

  IF v_heads > 0 AND p_arrived > 0 AND v_heads - p_arrived <= 0 THEN
    INSERT INTO public.section_occupancy (section_id, farm_id, occupied_since)
    VALUES (p_section_id, v_farm_id, now())
    ON CONFLICT (section_id) DO UPDATE
      SET occupied_since = now(), updated_at = now();
  ELSIF v_heads = 0 AND p_departed > 0 THEN
    INSERT INTO public.section_occupancy (section_id, farm_id, occupied_since, last_vacated_at)
    VALUES (p_section_id, v_farm_id, NULL, now())
    ON CONFLICT (section_id) DO UPDATE
      SET occupied_since = NULL, last_vacated_at = now(), updated_at = now();
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.track_section_occupancy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_old_count INTEGER := CASE WHEN TG_OP = 'INSERT' THEN 0 ELSE GREATEST(COALESCE(OLD.count, 0), 0) END;
  v_new_count INTEGER := CASE WHEN TG_OP = 'DELETE' THEN 0 ELSE GREATEST(COALESCE(NEW.count, 0), 0) END;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.refresh_section_occupancy(NEW.section_id, v_new_count, 0);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.refresh_section_occupancy(OLD.section_id, 0, v_old_count);
  ELSIF OLD.section_id IS DISTINCT FROM NEW.section_id THEN
    PERFORM public.refresh_section_occupancy(OLD.section_id, 0, v_old_count);
    PERFORM public.refresh_section_occupancy(NEW.section_id, v_new_count, 0);
  ELSIF v_old_count <> v_new_count THEN
    PERFORM public.refresh_section_occupancy(
      NEW.section_id,
      GREATEST(v_new_count - v_old_count, 0),
      GREATEST(v_old_count - v_new_count, 0)
    );
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.refresh_section_occupancy(UUID, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.track_section_occupancy() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS track_section_occupancy ON public.cattle;
CREATE TRIGGER track_section_occupancy
  AFTER INSERT OR DELETE OR UPDATE OF section_id, count ON public.cattle
  FOR EACH ROW EXECUTE FUNCTION public.track_section_occupancy();

-- ═══════════════════════════════════════════════════════════════
-- 046_set_updated_at_search_path.sql
-- ═══════════════════════════════════════════════════════════════
-- Supabase advisor 0011 (function_search_path_mutable) flagged set_updated_at
-- (043): a trigger function without a fixed search_path resolves names
-- through the caller's path. It only assigns NEW.updated_at := now(), but
-- pinning the path is free and matches every other function in the schema.
ALTER FUNCTION public.set_updated_at() SET search_path = public;

-- ═══════════════════════════════════════════════════════════════
-- 047_grazing_periods.sql
-- ═══════════════════════════════════════════════════════════════
-- LOOP iteration 1: grazing history per potrero.
--
-- section_occupancy (045) only holds the current clock, so the app cannot
-- say whether a potrero actually rested long enough last time, or how many
-- animal-days it carried this season. grazing_periods keeps one row per
-- occupation: opened when a potrero is stocked, closed when it is emptied.
--
-- It is driven by a trigger on section_occupancy rather than on cattle, so
-- every way the clock moves -- the 045 cattle trigger and the manual
-- "¿desde cuándo?" date -- lands here, and 045's proven function is not
-- touched. Same SECURITY DEFINER / fixed search_path / revoked EXECUTE
-- pattern as 045, and the same farm-exists guard for the delete cascade.
CREATE TABLE IF NOT EXISTS public.grazing_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id UUID NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  section_id UUID NOT NULL REFERENCES public.sections(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  -- Heads present when the period opened: with the length, an animal-days
  -- estimate. Not updated for later arrivals (see summarizeGrazingHistory).
  heads_at_start INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);

-- At most one open period per potrero.
CREATE UNIQUE INDEX IF NOT EXISTS idx_grazing_periods_open ON public.grazing_periods(section_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_grazing_periods_farm_section ON public.grazing_periods(farm_id, section_id, started_at DESC);

ALTER TABLE public.grazing_periods ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access" ON public.grazing_periods;
CREATE POLICY "Service role full access" ON public.grazing_periods
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.track_grazing_periods()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_old_since TIMESTAMPTZ := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.occupied_since END;
  v_heads INTEGER;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.farms WHERE id = NEW.farm_id) THEN
    RETURN NEW;
  END IF;

  IF v_old_since IS NULL AND NEW.occupied_since IS NOT NULL THEN
    -- Stocked: open a period. A stray open one (should not exist) is closed first.
    UPDATE public.grazing_periods SET ended_at = GREATEST(started_at, NEW.occupied_since)
      WHERE section_id = NEW.section_id AND ended_at IS NULL;
    SELECT COALESCE(SUM(count), 0) INTO v_heads FROM public.cattle WHERE section_id = NEW.section_id AND count > 0;
    INSERT INTO public.grazing_periods (farm_id, section_id, started_at, heads_at_start)
      VALUES (NEW.farm_id, NEW.section_id, NEW.occupied_since, v_heads);
  ELSIF v_old_since IS NOT NULL AND NEW.occupied_since IS NULL THEN
    -- Emptied: close the open period.
    UPDATE public.grazing_periods
      SET ended_at = GREATEST(started_at, COALESCE(NEW.last_vacated_at, now()))
      WHERE section_id = NEW.section_id AND ended_at IS NULL;
  ELSIF v_old_since IS NOT NULL AND NEW.occupied_since IS DISTINCT FROM v_old_since THEN
    -- Start corrected by hand while stocked.
    UPDATE public.grazing_periods SET started_at = NEW.occupied_since
      WHERE section_id = NEW.section_id AND ended_at IS NULL;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.track_grazing_periods() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS track_grazing_periods ON public.section_occupancy;
CREATE TRIGGER track_grazing_periods
  AFTER INSERT OR UPDATE OF occupied_since ON public.section_occupancy
  FOR EACH ROW EXECUTE FUNCTION public.track_grazing_periods();

-- ═══════════════════════════════════════════════════════════════
-- 048_grazing_period_peak_heads.sql
-- ═══════════════════════════════════════════════════════════════
-- LOOP iteration 1b: found by the live check of 047.
--
-- 047 recorded the heads present when a period opened. A whole-herd move
-- arrives as one batch at a time (one move_cattle call each), so the first
-- batch opened the period and later arrivals -- into an already-occupied
-- potrero -- never touched it: moving 48 head into I-995 recorded 3.
-- peak_heads keeps the most heads seen during the open period; a trigger on
-- cattle raises it on every arrival. Animal-days use it instead.
ALTER TABLE public.grazing_periods ADD COLUMN IF NOT EXISTS peak_heads INTEGER NOT NULL DEFAULT 0;
UPDATE public.grazing_periods SET peak_heads = heads_at_start WHERE peak_heads < heads_at_start;

-- Refresh the open period of each section a cattle row change touches.
-- Periods are opened by 047's trigger on section_occupancy; this only raises
-- the peak, so trigger order on cattle does not matter.
CREATE OR REPLACE FUNCTION public.track_grazing_peak()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_section UUID := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.section_id END;
BEGIN
  IF v_section IS NOT NULL THEN
    UPDATE public.grazing_periods p
      SET peak_heads = GREATEST(p.peak_heads, (SELECT COALESCE(SUM(c.count), 0) FROM public.cattle c WHERE c.section_id = v_section AND c.count > 0))
      WHERE p.section_id = v_section AND p.ended_at IS NULL;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.track_grazing_peak() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS track_grazing_peak ON public.cattle;
CREATE TRIGGER track_grazing_peak
  AFTER INSERT OR UPDATE OF section_id, count ON public.cattle
  FOR EACH ROW EXECUTE FUNCTION public.track_grazing_peak();

-- New periods start with their peak equal to the heads present.
CREATE OR REPLACE FUNCTION public.track_grazing_periods()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_old_since TIMESTAMPTZ := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.occupied_since END;
  v_heads INTEGER;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.farms WHERE id = NEW.farm_id) THEN
    RETURN NEW;
  END IF;

  IF v_old_since IS NULL AND NEW.occupied_since IS NOT NULL THEN
    UPDATE public.grazing_periods SET ended_at = GREATEST(started_at, NEW.occupied_since)
      WHERE section_id = NEW.section_id AND ended_at IS NULL;
    SELECT COALESCE(SUM(count), 0) INTO v_heads FROM public.cattle WHERE section_id = NEW.section_id AND count > 0;
    INSERT INTO public.grazing_periods (farm_id, section_id, started_at, heads_at_start, peak_heads)
      VALUES (NEW.farm_id, NEW.section_id, NEW.occupied_since, v_heads, v_heads);
  ELSIF v_old_since IS NOT NULL AND NEW.occupied_since IS NULL THEN
    UPDATE public.grazing_periods
      SET ended_at = GREATEST(started_at, COALESCE(NEW.last_vacated_at, now()))
      WHERE section_id = NEW.section_id AND ended_at IS NULL;
  ELSIF v_old_since IS NOT NULL AND NEW.occupied_since IS DISTINCT FROM v_old_since THEN
    UPDATE public.grazing_periods SET started_at = NEW.occupied_since
      WHERE section_id = NEW.section_id AND ended_at IS NULL;
  END IF;
  RETURN NEW;
END;
$function$;

-- ═══════════════════════════════════════════════════════════════
-- 049_grazing_peaks_lock_order.sql
-- ═══════════════════════════════════════════════════════════════
-- LOOP iteration 1b, review finding on 048.
--
-- 048's trigger on cattle raised grazing_periods.peak_heads directly. That
-- locks an arrival potrero's open period BEFORE the departure potrero's
-- clock and period (045/047 lock section_occupancy -> grazing_periods).
-- Two opposite moves at once (A->X and X->A) then each hold one period and
-- wait for the other: a deadlock that aborts a user's move.
--
-- Running peaks move to their own table. Global lock order becomes
-- section_occupancy -> grazing_periods -> grazing_period_peaks:
--   * the arrival trigger touches only grazing_period_peaks, and fires last
--     on cattle (name sorts after track_section_occupancy);
--   * opening a period (047 trigger, already holding clock and period)
--     resets the peak row; closing copies the peak into the period.
-- Nothing ever waits for a clock or period row while holding a peak row.
CREATE TABLE IF NOT EXISTS public.grazing_period_peaks (
  section_id UUID PRIMARY KEY REFERENCES public.sections(id) ON DELETE CASCADE,
  farm_id UUID NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  peak_heads INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_grazing_period_peaks_farm ON public.grazing_period_peaks(farm_id);
ALTER TABLE public.grazing_period_peaks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access" ON public.grazing_period_peaks;
CREATE POLICY "Service role full access" ON public.grazing_period_peaks
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Seed from open periods so the switch loses nothing.
INSERT INTO public.grazing_period_peaks (section_id, farm_id, peak_heads)
  SELECT section_id, farm_id, GREATEST(heads_at_start, peak_heads) FROM public.grazing_periods WHERE ended_at IS NULL
  ON CONFLICT (section_id) DO NOTHING;

DROP TRIGGER IF EXISTS track_grazing_peak ON public.cattle;
DROP FUNCTION IF EXISTS public.track_grazing_peak();

CREATE OR REPLACE FUNCTION public.track_zz_grazing_peak()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_heads INTEGER;
BEGIN
  -- Only arrivals can raise a peak: a new batch, a batch moved in, a count up.
  IF NEW.section_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.section_id IS NOT DISTINCT FROM NEW.section_id AND COALESCE(NEW.count, 0) <= COALESCE(OLD.count, 0) THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.farms WHERE id = NEW.farm_id) THEN RETURN NEW; END IF;
  SELECT COALESCE(SUM(count), 0) INTO v_heads FROM public.cattle WHERE section_id = NEW.section_id AND count > 0;
  INSERT INTO public.grazing_period_peaks (section_id, farm_id, peak_heads)
    VALUES (NEW.section_id, NEW.farm_id, v_heads)
    ON CONFLICT (section_id) DO UPDATE
      SET peak_heads = GREATEST(public.grazing_period_peaks.peak_heads, EXCLUDED.peak_heads), updated_at = now();
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.track_zz_grazing_peak() FROM PUBLIC, anon, authenticated;

-- Named to fire after track_section_occupancy (triggers run in name order).
DROP TRIGGER IF EXISTS track_zz_grazing_peak ON public.cattle;
CREATE TRIGGER track_zz_grazing_peak
  AFTER INSERT OR UPDATE OF section_id, count ON public.cattle
  FOR EACH ROW EXECUTE FUNCTION public.track_zz_grazing_peak();

CREATE OR REPLACE FUNCTION public.track_grazing_periods()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_old_since TIMESTAMPTZ := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.occupied_since END;
  v_heads INTEGER;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.farms WHERE id = NEW.farm_id) THEN
    RETURN NEW;
  END IF;

  IF v_old_since IS NULL AND NEW.occupied_since IS NOT NULL THEN
    UPDATE public.grazing_periods SET ended_at = GREATEST(started_at, NEW.occupied_since)
      WHERE section_id = NEW.section_id AND ended_at IS NULL;
    SELECT COALESCE(SUM(count), 0) INTO v_heads FROM public.cattle WHERE section_id = NEW.section_id AND count > 0;
    INSERT INTO public.grazing_periods (farm_id, section_id, started_at, heads_at_start, peak_heads)
      VALUES (NEW.farm_id, NEW.section_id, NEW.occupied_since, v_heads, v_heads);
    -- A new period starts its peak from the heads present (lock order: peak last).
    INSERT INTO public.grazing_period_peaks (section_id, farm_id, peak_heads)
      VALUES (NEW.section_id, NEW.farm_id, v_heads)
      ON CONFLICT (section_id) DO UPDATE SET peak_heads = EXCLUDED.peak_heads, updated_at = now();
  ELSIF v_old_since IS NOT NULL AND NEW.occupied_since IS NULL THEN
    -- Closing: keep the running peak on the period (read without locking).
    UPDATE public.grazing_periods
      SET ended_at = GREATEST(started_at, COALESCE(NEW.last_vacated_at, now())),
          peak_heads = GREATEST(peak_heads, COALESCE((SELECT k.peak_heads FROM public.grazing_period_peaks k WHERE k.section_id = NEW.section_id), 0))
      WHERE section_id = NEW.section_id AND ended_at IS NULL;
  ELSIF v_old_since IS NOT NULL AND NEW.occupied_since IS DISTINCT FROM v_old_since THEN
    UPDATE public.grazing_periods SET started_at = NEW.occupied_since
      WHERE section_id = NEW.section_id AND ended_at IS NULL;
  END IF;
  RETURN NEW;
END;
$function$;


-- ═══════════════════════════════════════════════════════════════
-- 050_close_internal_tables_and_graphql.sql
-- ═══════════════════════════════════════════════════════════════
-- 050: Close service-role-only tables to API roles; drop unused pg_graphql.
--
-- These tables are written and read only by server routes through the
-- service-role client (see supabase/README.md "RLS"). Their only policy is
-- "Service role full access", so RLS already returns zero rows to anon and
-- authenticated — but the table grants still let every signed-in account
-- discover them (advisor 0027). Revoking the grants makes the intent explicit.
--
-- pg_graphql is unused (the app talks to PostgREST and Auth only) and exposes
-- the schema of every table to any signed-in account. Re-enable with
-- `CREATE EXTENSION pg_graphql;` if GraphQL is ever needed.

REVOKE ALL ON TABLE
  public.ai_confirmed_requests,
  public.cattle_move_idempotency,
  public.grazing_period_peaks,
  public.grazing_periods,
  public.rate_limit_buckets,
  public.section_occupancy,
  public.whatsapp_events
FROM anon, authenticated;

-- ai_confirmed_requests is deleted with its farm (FK cascade); without an
-- index every farm delete scans the table (advisor 0001).
CREATE INDEX IF NOT EXISTS idx_ai_confirmed_requests_farm_id
  ON public.ai_confirmed_requests (farm_id);

DROP EXTENSION IF EXISTS pg_graphql;


-- ═══════════════════════════════════════════════════════════════
-- 051_apply_ai_operations.sql
-- ═══════════════════════════════════════════════════════════════
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
-- them before any trigger row. Not covered: the occupancy trigger (045) locks
-- the departure potrero's clock before the arrival's, so a UI move A->X racing
-- a batch move X->A could in principle cycle on section_occupancy. 045 writes
-- a clock only when a potrero empties or gets its first herd, which both moves
-- cannot need at once; if it ever happened, Postgres aborts one side (40P01)
-- and the batch rolls back whole ("reintentá"). Review of #52; see ROADMAP.
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


-- ═══════════════════════════════════════════════════════════════
-- 053_task_status_and_assignee.sql
-- ═══════════════════════════════════════════════════════════════
-- Loop 31: tasks become tickets — an "En curso" status and an assignee.
--
-- 1. status gains 'in_progress'. It is still open work: alerts, agenda, the
--    daily plan, the calendar and the AI deadlines all read
--    status IN ('pending', 'in_progress'). The original CHECK was declared
--    inline in 014 (auto-named tasks_status_check); it is dropped by lookup
--    rather than by name so a hand-renamed constraint cannot survive.
-- 2. assigned_to: the auth user id of a farm member. The API validates
--    membership first (clear 400); the BEFORE trigger enforces the same rule
--    for every other write path (AI RPC 051, SQL editor, a future route).
--    It only checks when assigned_to changes, so a task assigned to someone
--    who later left the farm can still be completed or edited.
-- 3. Removing a member unassigns their tasks in that farm (AFTER DELETE on
--    farm_members). Deleting the auth user does the same through the FK.
--
-- Lock order: the tasks trigger reads farm_members without locking it; the
-- farm_members trigger locks the member row (the DELETE) and then the task
-- rows. Nothing locks tasks → farm_members, so no A→X / X→A cycle. The cost
-- is a benign race: an assignment committed while the same member is being
-- removed can survive; the UI shows it as "Ex miembro" and lets you reassign.

DO $$
DECLARE
  v_name TEXT;
BEGIN
  FOR v_name IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.tasks'::regclass
       AND contype = 'c'
       -- Only the status value list itself; another CHECK that merely mentions
       -- status (e.g. a completed_at rule) must survive.
       AND pg_get_constraintdef(oid) ~ '^CHECK \(\(status = ANY \(ARRAY\['
  LOOP
    EXECUTE format('ALTER TABLE public.tasks DROP CONSTRAINT %I', v_name);
  END LOOP;
END $$;

ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_status_check CHECK (status IN ('pending', 'in_progress', 'completed'));

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS assigned_to UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL;

-- FK side of auth user deletion, the member-removal cleanup and "Asignadas a mí".
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON public.tasks (assigned_to) WHERE assigned_to IS NOT NULL;

-- The task detail's "Historial" reads the audit rows (012/035) of one record.
CREATE INDEX IF NOT EXISTS idx_activities_farm_record ON public.activities (farm_id, (metadata->>'record_id'));

CREATE OR REPLACE FUNCTION public.check_task_assignee()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.assigned_to IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.assigned_to IS NOT DISTINCT FROM OLD.assigned_to AND NEW.farm_id = OLD.farm_id THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM farm_members WHERE farm_id = NEW.farm_id AND user_id = NEW.assigned_to)
     AND NOT EXISTS (SELECT 1 FROM farms WHERE id = NEW.farm_id AND user_id = NEW.assigned_to) THEN
    RAISE EXCEPTION 'assigned_to is not a member of this farm' USING ERRCODE = '23503', HINT = 'task_assignee_not_member';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.check_task_assignee() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS check_task_assignee ON public.tasks;
CREATE TRIGGER check_task_assignee
  BEFORE INSERT OR UPDATE OF assigned_to, farm_id ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.check_task_assignee();

CREATE OR REPLACE FUNCTION public.unassign_tasks_of_removed_member()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- A farm deletion cascades here after the farm row is gone; its tasks go too.
  IF NOT EXISTS (SELECT 1 FROM farms WHERE id = OLD.farm_id) THEN
    RETURN OLD;
  END IF;
  -- The owner keeps farms.user_id access even without a membership row.
  IF EXISTS (SELECT 1 FROM farms WHERE id = OLD.farm_id AND user_id = OLD.user_id) THEN
    RETURN OLD;
  END IF;
  UPDATE tasks SET assigned_to = NULL
   WHERE farm_id = OLD.farm_id AND assigned_to = OLD.user_id;
  RETURN OLD;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.unassign_tasks_of_removed_member() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS unassign_tasks_of_removed_member ON public.farm_members;
CREATE TRIGGER unassign_tasks_of_removed_member
  AFTER DELETE ON public.farm_members
  FOR EACH ROW EXECUTE FUNCTION public.unassign_tasks_of_removed_member();
