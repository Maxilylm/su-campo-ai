import { describe, expect, it } from "vitest";
import {
  detectInventoryMapping, emptyInventoryDraft, inventoryDraftsFromTable, inventoryImportPayload, normalizeInventoryCategory,
  normalizeInventoryCurrency, normalizeInventoryUnit, validateInventoryDrafts,
} from "./inventory-import";
import type { ImportTable } from "./import-table";

function table(headers: string[], rows: string[][]): ImportTable {
  return { headers, rows, headerRowIndex: 0, sheetName: null };
}

describe("value normalization", () => {
  it("maps categories, units and currencies as written", () => {
    expect(normalizeInventoryCategory("Agroquímicos")).toBe("agroquímico");
    expect(normalizeInventoryCategory("agroquimico")).toBe("agroquímico");
    expect(normalizeInventoryCategory("Vacunas")).toBe("medicamento");
    expect(normalizeInventoryCategory("Gasoil")).toBe("combustible");
    expect(normalizeInventoryCategory("Ración")).toBe("alimento");
    expect(normalizeInventoryCategory("Urea")).toBe("fertilizante");
    expect(normalizeInventoryCategory("Herramientas")).toBeNull();
    expect(normalizeInventoryCategory("Herramientas", { herramientas: "otro" })).toBe("otro");
    expect(normalizeInventoryUnit("Litros")).toBe("L");
    expect(normalizeInventoryUnit("lts.")).toBe("L");
    expect(normalizeInventoryUnit("Kgs")).toBe("kg");
    expect(normalizeInventoryUnit("bolsas")).toBe("unidad");
    expect(normalizeInventoryUnit("ds")).toBe("dosis");
    expect(normalizeInventoryUnit("toneladas")).toBeNull();
    expect(normalizeInventoryCurrency("U$S")).toBe("USD");
    expect(normalizeInventoryCurrency("$")).toBe("UYU");
    expect(normalizeInventoryCurrency("pesos")).toBe("UYU");
    expect(normalizeInventoryCurrency("ARS")).toBe("ARS");
    expect(normalizeInventoryCurrency("EUR")).toBeNull();
  });
});

describe("detectInventoryMapping", () => {
  it("needs a name column", () => {
    expect(detectInventoryMapping(["Producto", "Existencia", "Unidad", "Precio"])?.columns).toEqual({ name: 0, currentStock: 1, unit: 2, costPerUnit: 3 });
    expect(detectInventoryMapping(["Categoría", "Cantidad"])).toBeNull();
  });
});

describe("inventoryDraftsFromTable", () => {
  it("normalizes values, infers category from the name and skips totals", () => {
    const t = table(["Producto", "Unidad", "Existencia", "Precio", "Moneda"], [
      ["Ivermectina 1%", "Litros", "5", "U$S 12,50", "U$S"],
      ["Gasoil", "lts", "1.200,5", "", ""],
      ["Alambre", "", "-", "", "EUR"],
      ["Total", "", "", "", ""],
      ["", "kg", "3", "", ""],
    ]);
    const { drafts, skipped, warnings } = inventoryDraftsFromTable(t, detectInventoryMapping(t.headers)!);
    expect(skipped).toBe(2);
    expect(warnings).toEqual([]);
    expect(drafts).toEqual([
      { name: "Ivermectina 1%", category: "medicamento", unit: "L", currentStock: "5", minStock: "", costPerUnit: "12,50", currency: "USD", notes: "" },
      { name: "Gasoil", category: "combustible", unit: "L", currentStock: "1.200,5", minStock: "", costPerUnit: "", currency: "USD", notes: "" },
      { name: "Alambre", category: "otro", unit: "unidad", currentStock: "0", minStock: "", costPerUnit: "", currency: "EUR", notes: "" },
    ]);
    const validation = validateInventoryDrafts(drafts);
    expect(validation.rowErrors[0]).toEqual([]);
    expect(validation.rowErrors[2]).toEqual(["Moneda «EUR» no reconocida."]);
  });

  it("reads units and currencies written next to numbers, and flags anything else", () => {
    const t = table(["Producto", "Stock", "Costo"], [
      ["Urea", "300 kg", "$U 350"],
      ["Ración", "10 bolsas de 25 kg", "U$S 12"],
      ["Sal", "20", "15"],
    ]);
    const { drafts, warnings } = inventoryDraftsFromTable(t, detectInventoryMapping(t.headers)!);
    expect(drafts[0]).toMatchObject({ unit: "kg", currentStock: "300", costPerUnit: "350", currency: "UYU" });
    expect(drafts[1]).toMatchObject({ currentStock: "10 bolsas de 25 kg", costPerUnit: "12", currency: "USD" });
    expect(drafts[2]).toMatchObject({ unit: "unidad", currentStock: "20", costPerUnit: "15", currency: "USD" });
    expect(warnings).toEqual(["En 1 fila no figura la moneda del costo: se asumió USD. Revisalo antes de importar."]);
    const validation = validateInventoryDrafts(drafts);
    expect(validation.rowErrors[1]).toEqual(["Stock actual: «10 bolsas de 25 kg» no es un número válido."]);
  });

  it("flags a unit or currency in the cell that contradicts its column", () => {
    const t = table(["Producto", "Unidad", "Stock", "Costo", "Moneda"], [["Urea", "L", "300 kg", "$U 350", "USD"]]);
    const { drafts } = inventoryDraftsFromTable(t, detectInventoryMapping(t.headers)!);
    expect(drafts[0]).toMatchObject({ unit: "L", currentStock: "300 kg", costPerUnit: "$U 350", currency: "USD" });
    expect(validateInventoryDrafts(drafts).valid).toBe(false);
  });

  it("resolves '1.125' per column, and flags it when the column gives no hint", () => {
    const exported = table(["name", "category", "unit", "current_stock", "min_stock", "cost_per_unit", "currency"], [["Ivermectina", "medicamento", "L", "1.125", "", "12.375", "USD"]]);
    const fromExport = inventoryDraftsFromTable(exported, detectInventoryMapping(exported.headers)!).drafts;
    expect(inventoryImportPayload(fromExport)).toMatchObject([{ currentStock: 1.125, costPerUnit: 12.375 }]);

    const uy = table(["Producto", "Stock"], [["Urea", "1.250"], ["Sal", "2,5"]]);
    expect(inventoryDraftsFromTable(uy, detectInventoryMapping(uy.headers)!).drafts[0].currentStock).toBe("1250");

    const unclear = table(["Producto", "Stock"], [["Urea", "1.250"], ["Sal", "20"]]);
    const drafts = inventoryDraftsFromTable(unclear, detectInventoryMapping(unclear.headers)!).drafts;
    expect(drafts[0].currentStock).toBe("1.250");
    expect(validateInventoryDrafts(drafts).rowErrors[0]).toEqual(["Stock actual: «1.250» es ambiguo; escribí 1250 o 1,250."]);
  });
});

describe("validateInventoryDrafts and payload", () => {
  it("flags bad values and builds numbers for the endpoint", () => {
    const bad = validateInventoryDrafts([{ ...emptyInventoryDraft(), name: "", unit: "ton", currentStock: "-1", costPerUnit: "abc" }]);
    expect(bad.rowErrors[0]).toEqual(["Falta el nombre.", "Unidad «ton» no reconocida.", "Stock actual inválido.", "Costo unitario: «abc» no es un número válido."]);
    const good = [{ ...emptyInventoryDraft(), name: " Urea ", category: "fertilizante", unit: "kg", currentStock: "1.250,5", minStock: "1000", costPerUnit: "0,8", currency: "USD" }];
    expect(validateInventoryDrafts(good).valid).toBe(true);
    expect(inventoryImportPayload(good)).toEqual([{ name: "Urea", category: "fertilizante", unit: "kg", currentStock: 1250.5, minStock: 1000, costPerUnit: 0.8, currency: "USD", notes: null }]);
  });
});
