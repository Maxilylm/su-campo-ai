-- CampoAI financial/inventory link integrity.
-- Resolve any existing duplicate links before applying this migration.

CREATE UNIQUE INDEX IF NOT EXISTS idx_financial_inventory_movement_unique
  ON financial_transactions(inventory_movement_id)
  WHERE inventory_movement_id IS NOT NULL;
