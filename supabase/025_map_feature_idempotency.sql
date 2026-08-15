-- CampoAI map feature retry safety.
-- Apply after 024_operational_idempotency.sql. A lost response must not create
-- duplicate roads, gates, ponds or other drawn infrastructure on retry.

ALTER TABLE map_features
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_map_features_idempotency
  ON map_features(farm_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
