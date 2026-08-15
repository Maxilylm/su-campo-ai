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
