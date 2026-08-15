import { describe, it, expect } from "vitest";
import { parseCSV, toCSV } from "./csv";

describe("toCSV", () => {
  it("returns empty string for no rows", () => {
    expect(toCSV([])).toBe("");
  });

  it("writes a header and rows", () => {
    expect(toCSV([{ a: 1, b: "x" }, { a: 2, b: "y" }])).toBe("\uFEFFa,b\n1,x\n2,y");
  });

  it("quotes values with commas, quotes, or newlines", () => {
    expect(toCSV([{ a: "x,y" }])).toBe('\uFEFFa\n"x,y"');
    expect(toCSV([{ a: 'he said "hi"' }])).toBe('\uFEFFa\n"he said ""hi"""');
    expect(toCSV([{ a: "line1\nline2" }])).toBe('\uFEFFa\n"line1\nline2"');
  });

  it("renders null/undefined as empty and unions keys", () => {
    expect(toCSV([{ a: 1 }, { b: 2 }])).toBe("\uFEFFa,b\n1,\n,2");
    expect(toCSV([{ a: null }])).toBe("\uFEFFa\n");
  });

  it("JSON-stringifies nested objects", () => {
    expect(toCSV([{ a: { n: "Norte" } }])).toBe('\uFEFFa\n"{""n"":""Norte""}"');
  });

  it("keeps formula-looking user values as text", () => {
    expect(toCSV([{ note: "=SUM(A1:A2)" }, { note: "@usuario" }])).toBe("\uFEFFnote\n'=SUM(A1:A2)\n'@usuario");
  });
});

describe("parseCSV", () => {
  it("parses BOM, CRLF and quoted commas/newlines", () => {
    const parsed = parseCSV('\uFEFFcategoria,cantidad,notas\r\nvaca,3,"Lote, Norte"\r\nnovillo,2,"Línea 2"');
    expect(parsed.headers).toEqual(["categoria", "cantidad", "notas"]);
    expect(parsed.rows).toEqual([["vaca", "3", "Lote, Norte"], ["novillo", "2", "Línea 2"]]);
  });

  it("ignores blank lines and pads short rows", () => {
    expect(parseCSV("a,b\n1\n\n")).toEqual({ headers: ["a", "b"], rows: [["1", ""]] });
  });

  it("detects semicolon-delimited regional CSV and preserves decimal commas", () => {
    const parsed = parseCSV("tipo;importe;descripcion\negreso;1.250,50;\"Compra; racion\"");
    expect(parsed.headers).toEqual(["tipo", "importe", "descripcion"]);
    expect(parsed.rows).toEqual([["egreso", "1.250,50", "Compra; racion"]]);
  });
});
