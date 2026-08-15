-- CampoAI task retry safety.
-- Apply after 021_cattle_move_transaction.sql. A lost response must not create
-- a duplicate task when the operator submits the same draft again.

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_idempotency
  ON tasks(farm_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
