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
      ["Ración", "kg", "10 bolsas de 25 kg", "", ""],
      ["Alambre", "", "-", "", "EUR"],
      ["Total", "", "", "", ""],
      ["", "kg", "3", "", ""],
    ]);
    const { drafts, skipped } = inventoryDraftsFromTable(t, detectInventoryMapping(t.headers)!);
    expect(skipped).toBe(2);
    expect(drafts[2]).toMatchObject({ name: "Ración", category: "alimento", unit: "kg", currentStock: "10" });
    drafts.splice(2, 1);
    expect(drafts).toEqual([
      { name: "Ivermectina 1%", category: "medicamento", unit: "L", currentStock: "5", minStock: "", costPerUnit: "12,50", currency: "USD", notes: "" },
      { name: "Gasoil", category: "combustible", unit: "L", currentStock: "1.200,5", minStock: "", costPerUnit: "", currency: "USD", notes: "" },
      { name: "Alambre", category: "otro", unit: "unidad", currentStock: "0", minStock: "", costPerUnit: "", currency: "EUR", notes: "" },
    ]);
    const validation = validateInventoryDrafts(drafts);
    expect(validation.rowErrors[0]).toEqual([]);
    expect(validation.rowErrors[2]).toEqual(["Moneda «EUR» no reconocida."]);
  });
});

describe("validateInventoryDrafts and payload", () => {
  it("flags bad values and builds numbers for the endpoint", () => {
    const bad = validateInventoryDrafts([{ ...emptyInventoryDraft(), name: "", unit: "ton", currentStock: "-1", costPerUnit: "abc" }]);
    expect(bad.rowErrors[0]).toEqual(["Falta el nombre.", "Unidad «ton» no reconocida.", "Stock actual inválido.", "Costo unitario inválido."]);
    const good = [{ ...emptyInventoryDraft(), name: " Urea ", category: "fertilizante", unit: "kg", currentStock: "1.250,5", minStock: "1.000", costPerUnit: "0,8", currency: "USD" }];
    expect(validateInventoryDrafts(good).valid).toBe(true);
    expect(inventoryImportPayload(good)).toEqual([{ name: "Urea", category: "fertilizante", unit: "kg", currentStock: 1250.5, minStock: 1000, costPerUnit: 0.8, currency: "USD", notes: null }]);
  });
});
