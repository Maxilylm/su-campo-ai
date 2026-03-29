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
