// Pure helpers for the Inventario page (stock status, valuation, form dirtiness).

export type StockStatus = "bajo" | "justo" | "ok";

/** "bajo" below the minimum, "justo" under twice the minimum, otherwise "ok".
 * Items without a minimum (null or 0) are always "ok". */
export function getStockStatus(item: { current_stock: number; min_stock: number | null }): StockStatus {
  if (!item.min_stock) return "ok";
  if (item.current_stock < item.min_stock) return "bajo";
  if (item.current_stock < 2 * item.min_stock) return "justo";
  return "ok";
}

/** Stock value (stock × unit cost) per currency, missing currency counted as USD. */
export function inventoryValueByCurrency(items: { current_stock: number; cost_per_unit: number | null; currency?: string | null }[]): Record<string, number> {
  return items.reduce<Record<string, number>>((totals, item) => {
    const currency = item.currency || "USD";
    totals[currency] = (totals[currency] || 0) + item.current_stock * (item.cost_per_unit || 0);
    return totals;
  }, {});
}

export type InventorySheetMode = "add-item" | "edit-item" | "compra" | "uso" | "ajuste" | "pérdida";

export interface InventoryFormSnapshot {
  mode: InventorySheetMode;
  editId: string | null;
  itemName: string;
  itemCategory: string;
  itemUnit: string;
  itemCurrency: string;
  itemMinStock: string;
  itemNotes: string;
  movItemId: string;
  movQuantity: string;
  movUnitCost: string;
  movCurrency: string;
  movSectionId: string;
  movCropId: string;
  movCattleId: string;
  movDate: string;
  movNotes: string;
}

/** Signature of only the fields the current sheet mode edits, so switching
 * between item and movement forms never reads the other form as dirty. */
export function inventoryFormSignature(snapshot: InventoryFormSnapshot): string {
  if (snapshot.mode === "add-item" || snapshot.mode === "edit-item") {
    return JSON.stringify({
      mode: snapshot.mode,
      editId: snapshot.editId,
      itemName: snapshot.itemName,
      itemCategory: snapshot.itemCategory,
      itemUnit: snapshot.itemUnit,
      itemCurrency: snapshot.itemCurrency,
      itemMinStock: snapshot.itemMinStock,
      itemNotes: snapshot.itemNotes,
    });
  }
  return JSON.stringify({
    mode: snapshot.mode,
    movItemId: snapshot.movItemId,
    movQuantity: snapshot.movQuantity,
    movUnitCost: snapshot.movUnitCost,
    movCurrency: snapshot.movCurrency,
    movSectionId: snapshot.movSectionId,
    movCropId: snapshot.movCropId,
    movCattleId: snapshot.movCattleId,
    movDate: snapshot.movDate,
    movNotes: snapshot.movNotes,
  });
}
