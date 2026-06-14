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
