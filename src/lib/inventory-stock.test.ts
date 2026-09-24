import { describe, expect, it } from "vitest";
import { getStockStatus, inventoryFormSignature, inventoryValueByCurrency, type InventoryFormSnapshot } from "./inventory-stock";

describe("getStockStatus", () => {
  it("treats items without a minimum as ok", () => {
    expect(getStockStatus({ current_stock: 0, min_stock: null })).toBe("ok");
    expect(getStockStatus({ current_stock: 0, min_stock: 0 })).toBe("ok");
  });

  it("is bajo below the minimum and justo under twice the minimum", () => {
    expect(getStockStatus({ current_stock: 4, min_stock: 5 })).toBe("bajo");
    expect(getStockStatus({ current_stock: 5, min_stock: 5 })).toBe("justo");
    expect(getStockStatus({ current_stock: 9.9, min_stock: 5 })).toBe("justo");
    expect(getStockStatus({ current_stock: 10, min_stock: 5 })).toBe("ok");
  });
});

describe("inventoryValueByCurrency", () => {
  it("sums stock × cost per currency, defaulting to USD and zero cost", () => {
    expect(inventoryValueByCurrency([
      { current_stock: 10, cost_per_unit: 2, currency: "USD" },
      { current_stock: 5, cost_per_unit: 4, currency: null },
      { current_stock: 3, cost_per_unit: null, currency: "UYU" },
      { current_stock: 2, cost_per_unit: 100, currency: "UYU" },
    ])).toEqual({ USD: 40, UYU: 200 });
  });

  it("is empty without items", () => {
    expect(inventoryValueByCurrency([])).toEqual({});
  });
});

describe("inventoryFormSignature", () => {
  const base: InventoryFormSnapshot = {
    mode: "add-item", editId: null,
    itemName: "Glifosato", itemCategory: "agroquímico", itemUnit: "L", itemCurrency: "USD", itemMinStock: "", itemNotes: "",
    movItemId: "", movQuantity: "", movUnitCost: "", movCurrency: "USD", movSectionId: "", movCropId: "", movCattleId: "", movDate: "", movNotes: "",
  };

  it("ignores movement fields while editing an item", () => {
    expect(inventoryFormSignature({ ...base, movQuantity: "5" })).toBe(inventoryFormSignature(base));
    expect(inventoryFormSignature({ ...base, itemName: "Otro" })).not.toBe(inventoryFormSignature(base));
  });

  it("ignores item fields while registering a movement", () => {
    const movement = { ...base, mode: "uso" as const, movItemId: "item-1" };
    expect(inventoryFormSignature({ ...movement, itemName: "Otro" })).toBe(inventoryFormSignature(movement));
    expect(inventoryFormSignature({ ...movement, movQuantity: "3" })).not.toBe(inventoryFormSignature(movement));
  });
});
