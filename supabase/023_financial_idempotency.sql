-- CampoAI financial retry safety.
-- Apply after 022_task_idempotency.sql. A lost response must not create a
-- duplicate income or expense when the same form is submitted again.

ALTER TABLE financial_transactions
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_financial_transactions_idempotency
  ON financial_transactions(farm_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
