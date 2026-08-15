-- CampoAI retry safety for inventory item creation.
-- A lost response must not create duplicate supplies when the operator retries.

ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_items_idempotency
  ON inventory_items(farm_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
