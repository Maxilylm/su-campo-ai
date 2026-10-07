import { describe, expect, it } from "vitest";
import { draftsFromTable, interpretTable } from "./smart-import";
import { gridToText, tableFromGrid, type ImportTable } from "./import-table";
import { parseCSVRows } from "./csv";
import { CATTLE_HEADER_KEYS, cattleImportPayload, validateCattleDrafts } from "./cattle-import";
import { INVENTORY_HEADER_KEYS, inventoryImportPayload, validateInventoryDrafts } from "./inventory-import";
import fs from "node:fs";

const SECTIONS = [{ id: "11111111-1111-4111-8111-111111111111", name: "Bajo" }];

function table(headers: string[], rows: string[][]): ImportTable {
  return { headers, rows, headerRowIndex: 0, sheetName: null };
}

describe("interpretTable", () => {
  it("recognizes a hacienda balance without AI", () => {
    const t = table(["Categoría", "Cantidad", "Peso prom", "Potrero"], [["Vacas", "10", "400", "Bajo"], ["Terneros", "8", "", "Bajo"]]);
    const result = interpretTable(t, "auto");
    expect(result.confident).toBe(true);
    expect(result.interpretation?.target).toBe("cattle");
    const built = draftsFromTable(t, result.interpretation!, SECTIONS);
    if (built.target !== "cattle") throw new Error("expected cattle");
    expect(built.drafts[0].sectionId).toBe(SECTIONS[0].id);
  });

  it("chooses inventory when categories are not livestock", () => {
    const t = table(["Nombre", "Categoría", "Unidad", "Stock"], [["Ivermectina", "medicamento", "L", "5"]]);
    expect(interpretTable(t, "auto")).toMatchObject({ confident: true, interpretation: { target: "inventory" } });
  });

  it("asks for AI when category texts are mostly unknown, keeping a fallback", () => {
    const t = table(["Categoría", "Cantidad"], [["Vientres entorados", "5"], ["Engorde", "3"], ["Recría", "2"]]);
    const result = interpretTable(t, "cattle");
    expect(result.confident).toBe(false);
    expect(result.interpretation?.target).toBe("cattle");
  });

  it("is not confident without a count column (DICOSE-style 'Nº'), so the AI maps it", () => {
    const t = table(["Especie", "Clase", "Nº"], [["Bovinos", "Vacas de cría", "120"]]);
    expect(interpretTable(t, "auto")).toMatchObject({ confident: false, interpretation: { target: "cattle" } });
    expect(interpretTable(t, "inventory")).toEqual({ interpretation: null, confident: false });
  });

  it("returns nothing for an unrecognizable layout", () => {
    const t = table(["Concepto", "Importe"], [["Flete", "1200"]]);
    expect(interpretTable(t, "auto")).toEqual({ interpretation: null, confident: false });
  });

  it("respects a forced target", () => {
    const t = table(["Nombre", "Categoría", "Cantidad"], [["Pepe", "vaca", "1"]]);
    expect(interpretTable(t, "cattle").interpretation?.target).toBe("cattle");
    expect(interpretTable(t, "inventory").interpretation?.target).toBe("inventory");
  });
});

describe("the downloadable CSV templates", () => {
  it("still import without AI (hacienda)", () => {
    const header = fs.readFileSync(new URL("../../public/plantilla-hacienda.csv", import.meta.url), "utf8").trim();
    const csv = `${header}\nBajo,novillo,12,Hereford,"380,5",,,2024-03-05,propio,,,,lote nuevo\n,vaca,1,,,UY 1,,,,,,,\n`;
    const t = tableFromGrid(gridToText(parseCSVRows(csv)), CATTLE_HEADER_KEYS);
    const result = interpretTable(t, "cattle");
    expect(result.confident).toBe(true);
    const built = draftsFromTable(t, result.interpretation!, SECTIONS);
    if (built.target !== "cattle") throw new Error("expected cattle");
    expect(validateCattleDrafts(built.drafts, SECTIONS).valid).toBe(true);
    expect(cattleImportPayload(built.drafts)).toMatchObject([
      { sectionId: SECTIONS[0].id, category: "novillo", count: 12, breed: "Hereford", weightKg: 380.5, birthDate: "2024-03-05", origin: "propio", notes: "lote nuevo" },
      { sectionId: null, category: "vaca", count: 1, earTag: "UY 1" },
    ]);
  });

  it("still import without AI (inventario)", () => {
    const header = fs.readFileSync(new URL("../../public/plantilla-inventario.csv", import.meta.url), "utf8").trim();
    const t = tableFromGrid(gridToText(parseCSVRows(`${header}\nIvermectina,medicamento,L,5,1,12,USD,\n`)), INVENTORY_HEADER_KEYS);
    const result = interpretTable(t, "inventory");
    expect(result.confident).toBe(true);
    const built = draftsFromTable(t, result.interpretation!, SECTIONS);
    if (built.target !== "inventory") throw new Error("expected inventory");
    expect(validateInventoryDrafts(built.drafts).valid).toBe(true);
    expect(inventoryImportPayload(built.drafts)).toEqual([{ name: "Ivermectina", category: "medicamento", unit: "L", currentStock: 5, minStock: 1, costPerUnit: 12, currency: "USD", notes: null }]);
  });
});
