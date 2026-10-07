import { describe, it, expect } from "vitest";
import { parseCSV, parseCSVRows, toCSV } from "./csv";

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

  it("also guards tab- and CR-led formula strings", () => {
    expect(toCSV([{ note: "\tcmd" }])).toBe("\uFEFFnote\n'\tcmd");
    expect(toCSV([{ note: "\rcmd" }])).toBe('\uFEFFnote\n"\'\rcmd"');
  });

  it("never quotes numeric cells into text, even negative ones", () => {
    expect(toCSV([{ amount: -500 }])).toBe("\uFEFFamount\n-500");
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

describe("parseCSVRows delimiter detection", () => {
  it("ignores a title line without separators", () => {
    expect(parseCSVRows("Inventario de hacienda\nCategoría;Cantidad\nvaca;3\n")).toEqual([["Inventario de hacienda"], ["Categoría", "Cantidad"], ["vaca", "3"]]);
  });

  it("is not fooled by a title with a comma or by decimal commas", () => {
    const rows = parseCSVRows("Hacienda, campo Las Rosas\nCategoría;Cantidad;Peso\nvaca;3;420,5\ntoro;1;650,0\nnovillo;5;380\n");
    expect(rows[1]).toEqual(["Categoría", "Cantidad", "Peso"]);
    expect(rows[2]).toEqual(["vaca", "3", "420,5"]);
  });

  it("keeps plain comma and tab files working", () => {
    expect(parseCSVRows("a,b,c\n1,2,3\n")).toEqual([["a", "b", "c"], ["1", "2", "3"]]);
    expect(parseCSVRows("a\tb\n1\t2")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCSVRows('nombre,nota\n"Pérez; Juan","a;b"\n')).toEqual([["nombre", "nota"], ["Pérez; Juan", "a;b"]]);
  });
});
