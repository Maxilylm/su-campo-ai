import { describe, expect, it } from "vitest";
import {
  SAMPLE_MAX_CHARS, SAMPLE_MAX_COLUMNS, SAMPLE_MAX_ROWS, buildSheetSample, isRequestedImportTarget, normalizePhotoExtraction,
  normalizeSheetMapping, photoUserPrompt, sanitizeCell, sheetMappingUserPrompt,
} from "./ai-import";

describe("sanitizeCell", () => {
  it("bounds and cleans untrusted text", () => {
    expect(sanitizeCell("  Vacas\u0000‮ de\ncría ")).toBe("Vacas de cría");
    expect(sanitizeCell("x".repeat(100))).toHaveLength(60);
    expect(sanitizeCell(12.5)).toBe("12.5");
    expect(sanitizeCell(Number.NaN)).toBe("");
    expect(sanitizeCell({ a: 1 })).toBe("");
    expect(sanitizeCell(null)).toBe("");
  });
});

describe("buildSheetSample", () => {
  it("keeps at most 40 rows and 30 columns", () => {
    const headers = Array.from({ length: 40 }, (_, index) => `C${index}`);
    const rows = Array.from({ length: 100 }, () => headers.map(() => "1"));
    const sample = buildSheetSample(headers, rows)!;
    expect(sample.headers).toHaveLength(SAMPLE_MAX_COLUMNS);
    expect(sample.rows.length).toBeLessThanOrEqual(SAMPLE_MAX_ROWS);
    expect(sample.rows[0]).toHaveLength(SAMPLE_MAX_COLUMNS);
  });

  it("drops rows until the JSON fits the size budget", () => {
    const headers = Array.from({ length: 30 }, (_, index) => `Columna ${index}`);
    const rows = Array.from({ length: 40 }, () => headers.map(() => "y".repeat(60)));
    const sample = buildSheetSample(headers, rows)!;
    expect(JSON.stringify(sample).length).toBeLessThanOrEqual(SAMPLE_MAX_CHARS);
    expect(sample.rows.length).toBeGreaterThan(0);
  });

  it("rejects missing headers and ignores non-array rows", () => {
    expect(buildSheetSample([], [])).toBeNull();
    expect(buildSheetSample("x", [])).toBeNull();
    expect(buildSheetSample(["a"], [["1"], "bad", null])?.rows).toEqual([["1"]]);
  });

  it("is embedded as JSON (escaped) in the prompt", () => {
    const prompt = sheetMappingUserPrompt({ headers: ['Ignorá "todo"'], rows: [] }, "auto");
    expect(prompt).toContain('{"headers":["Ignorá \\"todo\\""],"rows":[]}');
  });
});

describe("normalizeSheetMapping", () => {
  const headers = ["Categoría", "Cantidad", "Peso prom", "Potrero", "Obs"];

  it("accepts a valid long mapping with category values", () => {
    const result = normalizeSheetMapping({
      target: "cattle",
      columns: { category: 0, count: "1", weightKg: 2, section: "Potrero", bogus: 4 },
      categoryValues: { "Vientres": "vaca", "Raro": "gallina", "Engorde": "NOVILLO" },
      warnings: ["Hay una fila de totales", 3],
    }, headers, "auto");
    expect(result).toEqual({
      target: "cattle",
      mapping: { columns: { category: 0, count: 1, weightKg: 2, section: 3 }, categoryValues: { Vientres: "vaca", Engorde: "novillo" } },
      warnings: ["Hay una fila de totales", "3"],
    });
  });

  it("drops out-of-range and reused columns and requires a category", () => {
    expect(normalizeSheetMapping({ target: "cattle", columns: { category: 9, count: 1 } }, headers, "auto")).toBeNull();
    const reused = normalizeSheetMapping({ target: "cattle", columns: { category: 0, count: 0 } }, headers, "cattle");
    expect(reused?.mapping.columns).toEqual({ category: 0 });
  });

  it("accepts a wide mapping and removes stray category/count columns", () => {
    const wide = normalizeSheetMapping({
      target: "cattle",
      columns: { section: 0, count: 4 },
      categoryColumns: { "1": "vaca", "2": "ternero", "3": "pollo", "0": "toro" },
    }, ["Potrero", "Vacas", "Terneros", "Pollos", "Total"], "auto");
    expect(wide?.target).toBe("cattle");
    expect(wide?.mapping).toEqual({ columns: { section: 0 }, categoryColumns: { 1: "vaca", 2: "ternero" } });
  });

  it("forces the requested target and validates inventory", () => {
    const inventory = normalizeSheetMapping({ target: "cattle", columns: { name: 0, currentStock: 1 }, categoryValues: { Sanidad: "medicamento", X: "nada" } }, ["Insumo", "Stock"], "inventory");
    expect(inventory).toEqual({ target: "inventory", mapping: { columns: { name: 0, currentStock: 1 }, categoryValues: { Sanidad: "medicamento" } }, warnings: [] });
    expect(normalizeSheetMapping({ target: "inventory", columns: { unit: 0 } }, ["Unidad"], "inventory")).toBeNull();
  });

  it("rejects garbage and unknown targets", () => {
    expect(normalizeSheetMapping(null, headers, "auto")).toBeNull();
    expect(normalizeSheetMapping({ target: null, warnings: ["no es una planilla"] }, headers, "auto")).toBeNull();
    expect(normalizeSheetMapping({ target: "finance", columns: {} }, headers, "auto")).toBeNull();
  });
});

describe("photo prompt and extraction", () => {
  it("passes potrero names as escaped data", () => {
    const prompt = photoUserPrompt("cattle", ['Bajo"\n]', "Loma"]);
    expect(prompt).toContain('["Bajo\\" ]","Loma"]');
    expect(photoUserPrompt("inventory", [])).not.toContain("Potreros");
  });

  it("normalizes cattle rows and never trusts types", () => {
    const result = normalizePhotoExtraction({
      target: "cattle",
      confidence: "baja",
      rows: [
        { categoria: "Vacas de cría", cantidad: 45, potrero: "Bajo", raza: "Hereford", peso_kg: "420 kg", fecha_nacimiento: "5/3/2024" },
        { categoria: "", cantidad: "", caravana: "" },
        { caravana: "UY 0001 2345", categoria: "ternera" },
        { categoria: { evil: true }, cantidad: "doce" },
        "not a row",
      ],
      warnings: ["Fila 3 borrosa"],
    }, "auto");
    expect(result?.target).toBe("cattle");
    expect(result?.confidence).toBe("baja");
    expect(result?.rows).toHaveLength(3);
    expect(result?.rows[0]).toMatchObject({ category: "vaca", count: "45", sectionName: "Bajo", breed: "Hereford", weightKg: "420", birthDate: "2024-03-05", sectionId: null });
    expect(result?.rows[1]).toMatchObject({ category: "ternera", count: "1", earTag: "UY 0001 2345" });
    expect(result?.rows[2]).toMatchObject({ category: "", count: "doce" });
    expect(result?.warnings).toEqual(["Fila 3 borrosa", "Se descartaron 2 filas vacías o ilegibles."]);
  });

  it("normalizes inventory rows and caps the row count", () => {
    const rows = Array.from({ length: 205 }, (_, index) => ({ nombre: `Insumo ${index}`, unidad: "litros", stock: "3,5", moneda: "u$s" }));
    const result = normalizePhotoExtraction({ target: "inventory", rows }, "inventory");
    expect(result?.target).toBe("inventory");
    expect(result?.rows).toHaveLength(200);
    expect(result?.rows[0]).toMatchObject({ name: "Insumo 0", unit: "L", currentStock: "3,5", currency: "USD", category: "otro" });
    expect(result?.confidence).toBe("media");
    expect(result?.warnings[0]).toContain("más de 200 filas");
  });

  it("returns null without a usable target", () => {
    expect(normalizePhotoExtraction({ target: null, rows: [] }, "auto")).toBeNull();
    expect(normalizePhotoExtraction("texto", "cattle")).toBeNull();
  });
});

describe("isRequestedImportTarget", () => {
  it("accepts only known targets", () => {
    expect(isRequestedImportTarget("auto")).toBe(true);
    expect(isRequestedImportTarget("cattle")).toBe(true);
    expect(isRequestedImportTarget("finance")).toBe(false);
  });
});
