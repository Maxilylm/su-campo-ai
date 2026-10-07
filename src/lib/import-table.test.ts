import { describe, expect, it } from "vitest";
import {
  cellToText, columnDecimalStyle, decimalStyleOf, detectHeaderRow, gridToText, isAmbiguousNumber, isSummaryRow, normalizeHeaderKey, numberCell,
  numberProblem, parseImportNumber, pickSheet, resolveAmbiguousNumber, splitNumberCell, tableFromGrid,
} from "./import-table";
import { CATTLE_HEADER_KEYS } from "./cattle-import";
import { INVENTORY_HEADER_KEYS } from "./inventory-import";
import { parseCSVRows } from "./csv";

const BOTH = new Set([...CATTLE_HEADER_KEYS, ...INVENTORY_HEADER_KEYS]);

describe("cellToText", () => {
  it("renders Excel cell types as CSV-like text", () => {
    expect(cellToText(null)).toBe("");
    expect(cellToText(undefined)).toBe("");
    expect(cellToText(12)).toBe("12");
    expect(cellToText(420.49999999999994)).toBe("420,5");
    expect(cellToText(0.1 + 0.2)).toBe("0,3");
    expect(cellToText(2.125)).toBe("2,125");
    expect(cellToText(858000012345678)).toBe("858000012345678");
    expect(cellToText(true)).toBe("sí");
    expect(cellToText(new Date(Date.UTC(2024, 2, 5)))).toBe("2024-03-05");
    expect(cellToText(new Date(Number.NaN))).toBe("");
    expect(cellToText("  Vacas \n de cría ")).toBe("Vacas de cría");
  });
});

describe("normalizeHeaderKey", () => {
  it("drops case, accents and punctuation", () => {
    expect(normalizeHeaderKey("Peso prom. (kg)")).toBe("pesopromkg");
    expect(normalizeHeaderKey("Categoría")).toBe("categoria");
  });
});

describe("gridToText", () => {
  it("drops blank rows and trailing blank columns", () => {
    expect(gridToText([["a", null, "b", null], [null, null, null], [1, 2, null, ""]])).toEqual([["a", "", "b"], ["1", "2", ""]]);
  });
});

describe("detectHeaderRow", () => {
  it("finds a header below title lines", () => {
    const grid = [
      ["Establecimiento La Esperanza", "", "", ""],
      ["Balance de hacienda al 30/06/2026", "", "", ""],
      ["Categoría", "Cantidad", "Peso prom", "Potrero"],
      ["Vacas de cría", "120", "420", "Bajo"],
    ];
    expect(detectHeaderRow(grid, CATTLE_HEADER_KEYS)).toBe(2);
  });

  it("falls back to the first row with two text cells when no header is known", () => {
    const grid = [["Planilla"], ["Bicho", "Cuantos"], ["Vaca", "3"]];
    expect(detectHeaderRow(grid, CATTLE_HEADER_KEYS)).toBe(1);
  });

  it("uses row 0 for an all-numeric grid", () => {
    expect(detectHeaderRow([["1", "2"], ["3", "4"]], CATTLE_HEADER_KEYS)).toBe(0);
  });
});

describe("tableFromGrid", () => {
  it("names blank headers and pads short rows", () => {
    const table = tableFromGrid([["Categoría", "", "Cantidad"], ["vaca"]], CATTLE_HEADER_KEYS, "Hoja1");
    expect(table.headers).toEqual(["Categoría", "Columna 2", "Cantidad"]);
    expect(table.rows).toEqual([["vaca", "", ""]]);
    expect(table.sheetName).toBe("Hoja1");
  });

  it("handles an empty grid", () => {
    expect(tableFromGrid([], CATTLE_HEADER_KEYS).headers).toEqual([]);
  });

  it("works on a CSV with a title line (semicolon separated)", () => {
    const rows = parseCSVRows("Inventario de hacienda\nCategoría;Cantidad;Potrero\nVacas;10;Bajo\n");
    const table = tableFromGrid(gridToText(rows), CATTLE_HEADER_KEYS);
    expect(table.headers).toEqual(["Categoría", "Cantidad", "Potrero"]);
    expect(table.rows).toEqual([["Vacas", "10", "Bajo"]]);
  });
});

describe("pickSheet", () => {
  it("prefers the sheet with recognizable headers over a cover sheet", () => {
    const picked = pickSheet([
      { name: "Portada", rows: [["Campo"], ["Datos del establecimiento", "x"], ["a", "b"], ["c", "d"], ["e", "f"]] },
      { name: "Stock", rows: [["Nombre", "Unidad", "Stock"], ["Ivermectina", "L", 5]] },
    ], BOTH);
    expect(picked?.table.sheetName).toBe("Stock");
    expect(picked?.sheetNames).toEqual(["Portada", "Stock"]);
  });

  it("honors an explicitly chosen sheet and returns null when all are empty", () => {
    const sheets = [
      { name: "A", rows: [["Categoría", "Cantidad"], ["vaca", 1]] },
      { name: "B", rows: [["x", "y"], ["1", "2"]] },
    ];
    expect(pickSheet(sheets, BOTH, "B")?.table.sheetName).toBe("B");
    expect(pickSheet([{ name: "Vacía", rows: [[null], []] }], BOTH)).toBeNull();
  });
});

describe("isSummaryRow", () => {
  it("detects total lines", () => {
    expect(isSummaryRow(["", "Total", "150"])).toBe(true);
    expect(isSummaryRow(["SUBTOTAL vacunos", "80"])).toBe(true);
    expect(isSummaryRow(["Totales"])).toBe(true);
    expect(isSummaryRow(["Total general:", "300"])).toBe(true);
    expect(isSummaryRow(["Total Quartz 5W30", "4"])).toBe(false);
    expect(isSummaryRow(["Toros", "3"])).toBe(false);
    expect(isSummaryRow(["", ""])).toBe(false);
  });
});

describe("numberCell and parseImportNumber", () => {
  it("keeps the number only when the extra text is understood", () => {
    const isKg = (rest: string) => rest === "kg";
    expect(numberCell("300 kg", isKg)).toBe("300");
    expect(numberCell("10 bolsas de 25 kg", isKg)).toBe("10 bolsas de 25 kg");
    expect(numberCell("300 kg")).toBe("300 kg");
    expect(numberCell("1 250")).toBe("1250");
    expect(numberCell("1.250,5")).toBe("1.250,5");
    expect(numberCell("-")).toBe("");
    expect(numberCell("")).toBe("");
    expect(numberCell("s/d")).toBe("s/d");
    expect(splitNumberCell("$U 350")).toEqual({ number: "350", rest: "$U" });
    expect(splitNumberCell("U$S 12,50 c/u")).toEqual({ number: "12,50", rest: "U$S c/u" });
  });

  it("never guesses x1000 for a single dot group", () => {
    expect(Number.isNaN(parseImportNumber("1.250"))).toBe(true);
    expect(Number.isNaN(parseImportNumber("12.375"))).toBe(true);
    expect(isAmbiguousNumber("1.125")).toBe(true);
    expect(isAmbiguousNumber("1,125")).toBe(false);
    expect(parseImportNumber("12.500.000")).toBe(12500000);
    expect(parseImportNumber("0.125")).toBe(0.125);
    expect(parseImportNumber("1.25")).toBe(1.25);
    expect(parseImportNumber("1.250,5")).toBe(1250.5);
    expect(parseImportNumber("420,5")).toBe(420.5);
    expect(parseImportNumber("1,125")).toBe(1.125);
    expect(Number.isNaN(parseImportNumber("s/d"))).toBe(true);
    expect(numberProblem("Stock", "1.125")).toBe("Stock: «1.125» es ambiguo; escribí 1125 o 1,125.");
    expect(numberProblem("Stock", "abc")).toBe("Stock: «abc» no es un número válido.");
  });

  it("resolves ambiguous values from the column's other values", () => {
    expect(decimalStyleOf(["1.125", "2.5", "10"])).toBe("dot");
    expect(decimalStyleOf(["1.125", "2,5"])).toBe("comma");
    expect(decimalStyleOf(["1.125", "1.250.000"])).toBe("comma");
    expect(decimalStyleOf(["1.125", "300"])).toBe("unknown");
    expect(decimalStyleOf(["2.5", "2,5"])).toBe("unknown");
    expect(resolveAmbiguousNumber("1.125", "dot")).toBe("1,125");
    expect(resolveAmbiguousNumber("1.125", "comma")).toBe("1125");
    expect(resolveAmbiguousNumber("1.125", "unknown")).toBe("1.125");
    expect(resolveAmbiguousNumber("2.5", "comma")).toBe("2.5");
  });

  it("treats the app's own snake_case export as dot decimals", () => {
    const exported = { headers: ["name", "current_stock", "cost_per_unit"], rows: [], headerRowIndex: 0, sheetName: null };
    expect(columnDecimalStyle(exported, ["1.125"])).toBe("dot");
    const spanish = { ...exported, headers: ["Nombre", "Stock", "Costo"] };
    expect(columnDecimalStyle(spanish, ["1.125"])).toBe("unknown");
  });
});
