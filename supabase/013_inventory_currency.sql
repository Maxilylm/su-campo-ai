-- CampoAI: preserve currency on inventory movements and stock valuation.
-- Apply after 012_audit_triggers.sql.

ALTER TABLE inventory_movements
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD';

CREATE OR REPLACE FUNCTION update_inventory_stock()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE inventory_items
  SET current_stock = current_stock + NEW.quantity
  WHERE id = NEW.item_id;

  IF NEW.type = 'compra' AND NEW.unit_cost IS NOT NULL THEN
    UPDATE inventory_items
    SET cost_per_unit = NEW.unit_cost,
        currency = COALESCE(NULLIF(NEW.currency, ''), currency)
    WHERE id = NEW.item_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
