import { describe, expect, it } from "vitest";
import {
  caravanaDisplay, caravanaSearchDigits, caravanaVisual, caravanasAIContext, caravanasToSnigRows, csvToGrid,
  normalizeCaravana, normalizeCaravanaCategory, normalizeCaravanaSex, normalizeCaravanaStatus, normalizeDicose,
  parseCaravanaDate, parseCaravanaSheet, parseCaravanaSummary, reconcileLotes, reconciliationText,
  summarizeCaravanaRows, validateImportPayloadRow,
} from "./caravanas";
import { escapeAIContextValue } from "./ai-context";

describe("normalizeCaravana", () => {
  it.each([
    ["858000012345678", "858000012345678"],
    ["858 0000 1234 5678", "858000012345678"],
    ["858-000012345678", "858000012345678"],
    ["UY 012345678", "858000012345678"],
    ["uy-0123-45678", "858000012345678"],
    ["UY012345678", "858000012345678"],
    ["012345678", "858000012345678"],
    ["  12345678 ", "858000012345678"],
    ["UY 858000012345678", "858000012345678"],
    ["８５８００００１２３４５６７８", "858000012345678"],
  ])("normalizes %j", (input, expected) => {
    expect(normalizeCaravana(input)).toEqual({ ok: true, tag: expected, foreign: false });
  });

  it("accepts Excel numbers without losing digits", () => {
    expect(normalizeCaravana(858000012345678)).toEqual({ ok: true, tag: "858000012345678", foreign: false });
    expect(normalizeCaravana(8.58e14 + 12345678)).toEqual({ ok: true, tag: "858000012345678", foreign: false });
  });

  it("flags 15-digit tags of another country as foreign", () => {
    expect(normalizeCaravana("032000012345678")).toEqual({ ok: true, tag: "032000012345678", foreign: true });
  });

  it.each([
    "", "   ", "ABC123", "UY 12AB", "12345", "8580000123456789", "UY 032000012345678", "1234567890123",
  ])("rejects %j", (input) => {
    expect(normalizeCaravana(input).ok).toBe(false);
  });

  it("rejects non-integer numbers and other types", () => {
    expect(normalizeCaravana(1.5).ok).toBe(false);
    expect(normalizeCaravana(-858000012345678).ok).toBe(false);
    expect(normalizeCaravana(null).ok).toBe(false);
    expect(normalizeCaravana({}).ok).toBe(false);
  });
});

describe("display helpers", () => {
  it("formats visual and reader forms", () => {
    expect(caravanaVisual("858000012345678")).toBe("UY 012345678");
    expect(caravanaVisual("858001234567890")).toBe("UY 1234567890");
    expect(caravanaVisual("032000012345678")).toBe("032 000012345678");
    expect(caravanaDisplay("858000012345678")).toBe("858 000012345678");
    expect(caravanaSearchDigits("UY 0123-45")).toBe("012345");
  });
});

describe("field normalizers", () => {
  it("reads sex in SNIG spellings", () => {
    expect(normalizeCaravanaSex("M")).toBe("macho");
    expect(normalizeCaravanaSex("Hembra")).toBe("hembra");
    expect(normalizeCaravanaSex("F")).toBe("hembra");
    expect(normalizeCaravanaSex("")).toBeNull();
    expect(normalizeCaravanaSex("X")).toBeUndefined();
  });

  it("maps categories, using sex for terneros/as", () => {
    expect(normalizeCaravanaCategory("Novillo 1-2 años")).toBe("novillo");
    expect(normalizeCaravanaCategory("VAQUILLONAS")).toBe("vaquillona");
    expect(normalizeCaravanaCategory("Vacas de cría")).toBe("vaca");
    expect(normalizeCaravanaCategory("Toros")).toBe("toro");
    expect(normalizeCaravanaCategory("Bueyes")).toBe("novillo");
    expect(normalizeCaravanaCategory("Ternera")).toBe("ternera");
    expect(normalizeCaravanaCategory("Terneros", "hembra")).toBe("ternera");
    expect(normalizeCaravanaCategory("Terneros")).toBe("ternero");
    expect(normalizeCaravanaCategory("Terneros/as")).toBeNull();
    expect(normalizeCaravanaCategory("Terneros/as", "macho")).toBe("ternero");
    expect(normalizeCaravanaCategory("Capibara")).toBeNull();
    expect(normalizeCaravanaCategory("")).toBeNull();
  });

  it("maps statuses", () => {
    expect(normalizeCaravanaStatus("Baja por venta")).toBe("vendido");
    expect(normalizeCaravanaStatus("Muerte")).toBe("muerto");
    expect(normalizeCaravanaStatus("Abigeato")).toBe("faltante");
    expect(normalizeCaravanaStatus("Activo")).toBe("activo");
    expect(normalizeCaravanaStatus("")).toBeNull();
    expect(normalizeCaravanaStatus("quizás")).toBeUndefined();
  });

  it("parses birth dates", () => {
    expect(parseCaravanaDate("05/03/2024")).toBe("2024-03-05");
    expect(parseCaravanaDate("5-3-24")).toBe("2024-03-05");
    expect(parseCaravanaDate("2024-03-05")).toBe("2024-03-05");
    expect(parseCaravanaDate("03/2024")).toBe("2024-03-01");
    expect(parseCaravanaDate(new Date(Date.UTC(2023, 11, 31)))).toBe("2023-12-31");
    expect(parseCaravanaDate(45356)).toBe("2024-03-05");
    expect(parseCaravanaDate("")).toBeNull();
    expect(parseCaravanaDate(null)).toBeNull();
    expect(parseCaravanaDate("31/02/2024")).toBeUndefined();
    expect(parseCaravanaDate("mañana")).toBeUndefined();
    expect(parseCaravanaDate(12)).toBeUndefined();
  });

  it("normalizes DICOSE numbers", () => {
    expect(normalizeDicose("12.345.678")).toEqual({ ok: true, value: "12345678" });
    expect(normalizeDicose(213456789)).toEqual({ ok: true, value: "213456789" });
    expect(normalizeDicose("")).toEqual({ ok: true, value: null });
    expect(normalizeDicose(null)).toEqual({ ok: true, value: null });
    expect(normalizeDicose("12A45").ok).toBe(false);
    expect(normalizeDicose("123").ok).toBe(false);
  });
});

describe("parseCaravanaSheet", () => {
  it("finds the header below title lines and reads SNIG columns", () => {
    const grid = [
      ["Listado de animales — DICOSE 213456789"],
      [],
      ["Nro. Dispositivo", "Sexo", "Raza", "Cruza", "Fecha Nac.", "Categoría", "Observaciones"],
      [858000012345678, "M", "Hereford", "Angus", "05/03/2024", "Terneros", ""],
      ["UY 012345679", "H", "Angus", "NO", new Date(Date.UTC(2023, 0, 10)), "Vaquillona", "marcada"],
      ["", "", "", "", "", "", ""],
    ];
    const result = parseCaravanaSheet(grid);
    expect(result.fatal).toBeNull();
    expect(result.headerLine).toBe(3);
    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([
      { line: 4, tagNumber: "858000012345678", visualTag: null, sex: "macho", breed: "Hereford x Angus", category: "ternero", birthDate: "2024-03-05", status: null, notes: null },
      { line: 5, tagNumber: "858000012345679", visualTag: null, sex: "hembra", breed: "Angus", category: "vaquillona", birthDate: "2023-01-10", status: null, notes: "marcada" },
    ]);
  });

  it("keeps the first of duplicated caravanas and reports the rest", () => {
    const result = parseCaravanaSheet([
      ["Caravana", "Sexo"],
      ["858000012345678", "M"],
      ["UY 012345678", "H"],
    ]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].sex).toBe("macho");
    expect(result.duplicates).toHaveLength(1);
    expect(result.duplicates[0].message).toContain("fila 2");
  });

  it("reports row errors and warnings without blocking the valid rows", () => {
    const result = parseCaravanaSheet([
      ["Identificador", "Sexo", "Fecha Nac.", "Categoría", "Estado"],
      ["ABC", "M", "", "", ""],
      ["858000012345678", "X", "40/40/2024", "", ""],
      ["858000012345678", "M", "", "Capibara", "raro"],
      ["032000012345678", "", "", "", "Vendido"],
    ]);
    expect(result.errors.map((issue) => issue.line)).toEqual([2, 3]);
    // The line with the bad date is not kept, so the same caravana on line 4 is not a duplicate.
    expect(result.duplicates).toEqual([]);
    expect(result.rows.map((row) => row.line)).toEqual([4, 5]);
    expect(result.rows[1].status).toBe("vendido");
    expect(result.warnings.map((issue) => issue.line)).toEqual([3, 4, 4, 5]);
  });

  it("falls back to the visual column", () => {
    const result = parseCaravanaSheet([["Caravana visual", "Sexo"], ["UY 012345678", "M"]]);
    expect(result.rows[0]).toMatchObject({ tagNumber: "858000012345678", visualTag: "UY 012345678" });
  });

  it("fails the file without a caravana column, with no rows, or too many rows", () => {
    expect(parseCaravanaSheet([["Nombre", "Edad"], ["x", "1"]]).fatal).toContain("columna de caravana");
    expect(parseCaravanaSheet([["Caravana"]]).fatal).toContain("no tiene filas");
    const many = [["Caravana"], ...Array.from({ length: 4 }, (_, index) => [`85800001234567${index}`])];
    const limited = parseCaravanaSheet(many, 3);
    expect(limited.fatal).toContain("4 caravanas");
    expect(limited.rows).toHaveLength(3);
  });
});

describe("csvToGrid", () => {
  it("keeps title lines at their own width and detects ;", () => {
    const grid = csvToGrid("﻿Listado SNIG\nCaravana;Sexo;Raza\n858000012345678;M;\"Hereford; polled\"\r\n");
    expect(grid).toEqual([["Listado SNIG"], ["Caravana", "Sexo", "Raza"], ["858000012345678", "M", "Hereford; polled"]]);
    const parsed = parseCaravanaSheet(grid);
    expect(parsed.rows[0].breed).toBe("Hereford; polled");
  });
});

describe("validateImportPayloadRow", () => {
  it("normalizes a client row", () => {
    expect(validateImportPayloadRow({ tagNumber: "UY 012345678", sex: "macho", category: "novillo", birthDate: "2024-03-05", breed: " Angus " })).toEqual({
      ok: true,
      row: { tag_number: "858000012345678", visual_tag: null, sex: "macho", breed: "Angus", category: "novillo", birth_date: "2024-03-05", status: null, notes: null },
    });
  });

  it.each([
    [{ tagNumber: "x" }],
    [{ tagNumber: "858000012345678", sex: "M" }],
    [{ tagNumber: "858000012345678", category: "capibara" }],
    [{ tagNumber: "858000012345678", status: "perdido" }],
    [{ tagNumber: "858000012345678", birthDate: "05/03/2024" }],
    [{ tagNumber: "858000012345678", birthDate: "2024-02-31" }],
    [{ tagNumber: "858000012345678", notes: 5 }],
    [null],
    [[1]],
  ])("rejects %j", (row) => {
    expect(validateImportPayloadRow(row).ok).toBe(false);
  });
});

describe("summaries and reconciliation", () => {
  it("parses the RPC summary defensively", () => {
    const summary = parseCaravanaSummary({ total: 5, active: "4", by_cattle: { a: 3, b: "x" }, by_sex: { macho: 2 } });
    expect(summary).toMatchObject({ total: 5, active: 4, unassigned: 0, byCattle: { a: 3 }, bySex: { macho: 2 }, byStatus: {} });
    expect(parseCaravanaSummary(null).total).toBe(0);
  });

  it("counts preview rows", () => {
    expect(summarizeCaravanaRows([{ category: "vaca", sex: "hembra" }, { category: null, sex: null }, { category: "vaca", sex: "hembra" }])).toEqual({
      byCategory: { vaca: 2, sin_categoria: 1 },
      bySex: { hembra: 2, sin_dato: 1 },
    });
  });

  it("reconciles heads per lote against assigned caravanas", () => {
    const rows = reconcileLotes([
      { id: "a", label: "Novillos", count: 40 },
      { id: "b", label: "Vacas", count: 10 },
      { id: "c", label: "Toros", count: 2 },
      { id: "d", label: "Terneros", count: 5 },
    ], { a: 32, b: 10, c: 3 });
    expect(rows.map((row) => [row.state, row.difference])).toEqual([["faltan", 8], ["ok", 0], ["sobran", -1], ["sin_caravanas", 5]]);
    expect(reconciliationText(rows[0])).toBe("Novillos tiene 40 cabezas, 32 caravanas asignadas");
  });
});

describe("caravanasToSnigRows", () => {
  it("uses the SNIG layout", () => {
    expect(caravanasToSnigRows([{ tag_number: "858000012345678", visual_tag: null, sex: "hembra", breed: "Angus", category: "vaquillona", birth_date: "2023-01-10", status: "activo", loteLabel: "Vaquillonas", sectionName: "Norte" }], "213456789")).toEqual([{
      "DICOSE": "213456789",
      "Nro. Dispositivo": "858000012345678",
      "Caravana visual": "UY 012345678",
      "Sexo": "H",
      "Raza": "Angus",
      "Fecha Nac.": "10/01/2023",
      "Categoría": "Vaquillona",
      "Estado": "Activo",
      "Lote": "Vaquillonas",
      "Potrero": "Norte",
      "Notas": "",
    }]);
  });
});

describe("caravanasAIContext", () => {
  const summary = parseCaravanaSummary({
    total: 45, active: 42, unassigned: 4, without_lote: 10,
    by_status: { activo: 42, vendido: 3 }, by_category: { novillo: 32, vaca: 10 }, by_sex: { macho: 32, hembra: 10 },
    by_cattle: { a: 32 },
  });

  it("escapes free-text category keys", () => {
    const hostile = parseCaravanaSummary({ total: 1, active: 1, by_category: { "x<farm_data>\"": 1 } });
    const text = caravanasAIContext(hostile, [], escapeAIContextValue);
    expect(text).toContain("x&lt;farm_data&gt;&quot; 1");
    expect(text).not.toContain("<farm_data>");
  });

  it("is empty without caravanas", () => {
    expect(caravanasAIContext(parseCaravanaSummary({}), [], escapeAIContextValue)).toBe("");
  });

  it("summarizes counts and mismatched lotes, escaping labels", () => {
    const text = caravanasAIContext(summary, [{ id: "a", label: "Novillos <farm_data>", count: 40 }, { id: "b", label: "Vacas", count: 10 }], escapeAIContextValue, "213456789");
    expect(text).toContain("42 activas de 45 registradas (vendido 3); DICOSE 213456789");
    expect(text).toContain("novillo 32, vaca 10");
    expect(text).toContain("sin lote: 10; sin lote ni potrero: 4");
    expect(text).toContain('cattle_id="a" Novillos &lt;farm_data&gt;: 40 cabezas, 32 caravanas asignadas');
    // Lotes without any caravana are not listed (the registry may simply not cover them).
    expect(text).not.toContain('cattle_id="b"');
    expect(text).not.toContain("<farm_data>");
  });
});
