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
