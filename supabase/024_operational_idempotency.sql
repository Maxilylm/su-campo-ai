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
