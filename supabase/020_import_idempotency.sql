-- CampoAI bulk import retry safety.
-- Apply after 019_padron_idempotency.sql. A CSV request keeps the same key and
-- row index across retries, so losing the response cannot duplicate a batch.

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
