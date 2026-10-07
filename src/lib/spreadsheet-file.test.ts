import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { SpreadsheetReadError, readSpreadsheetFile, spreadsheetKind } from "./spreadsheet-file";
import { fitWithin } from "./image-downscale";
import { pickSheet } from "./import-table";
import { CATTLE_HEADER_KEYS } from "./cattle-import";

describe("spreadsheetKind", () => {
  it("classifies by extension first, then MIME type", () => {
    expect(spreadsheetKind("hacienda.CSV", "")).toBe("csv");
    expect(spreadsheetKind("hacienda.xlsx", "")).toBe("xlsx");
    expect(spreadsheetKind("viejo.xls", "")).toBe("xls");
    expect(spreadsheetKind("IMG_001.HEIC", "")).toBe("image");
    expect(spreadsheetKind("foto", "image/jpeg")).toBe("image");
    expect(spreadsheetKind("doc.pdf", "application/pdf")).toBe("unknown");
  });
});

/** A minimal but real .xlsx: two sheets, shared strings, a number and a date-formatted cell. */
function buildXlsx(): Uint8Array {
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Portada" sheetId="1" r:id="rId1"/><sheet name="Hacienda" sheetId="2" r:id="rId2"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    "xl/styles.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="0"/><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14" applyNumberFormat="1"/></cellXfs></styleSheet>`),
    "xl/sharedStrings.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="7" uniqueCount="7"><si><t>Establecimiento La Esperanza</t></si><si><t>Categoría</t></si><si><t>Cantidad</t></si><si><t>Potrero</t></si><si><t>Vacas de cría</t></si><si><t>Bajo</t></si><si><t>Nacimiento</t></si></sst>`),
    "xl/worksheets/sheet1.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>`),
    "xl/worksheets/sheet2.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row><row r="3"><c r="A3" t="s"><v>1</v></c><c r="B3" t="s"><v>2</v></c><c r="C3" t="s"><v>3</v></c><c r="D3" t="s"><v>6</v></c></row><row r="4"><c r="A4" t="s"><v>4</v></c><c r="B4"><v>120</v></c><c r="C4" t="s"><v>5</v></c><c r="D4" s="1"><v>45356</v></c></row></sheetData></worksheet>`),
  };
  return zipSync(files);
}

describe("readSpreadsheetFile", () => {
  it("reads a CSV", async () => {
    const sheets = await readSpreadsheetFile(new File(["Categoría;Cantidad\nvaca;3\n"], "h.csv", { type: "text/csv" }));
    expect(sheets).toEqual([{ name: "h.csv", rows: [["Categoría", "Cantidad"], ["vaca", "3"]] }]);
  });

  it("reads every sheet of an .xlsx and picks the register sheet below its title", async () => {
    const bytes = buildXlsx();
    const sheets = await readSpreadsheetFile(new File([bytes.slice().buffer as ArrayBuffer], "balance.xlsx", { type: "" }));
    expect(sheets.map((sheet) => sheet.name)).toEqual(["Portada", "Hacienda"]);
    const picked = pickSheet(sheets, CATTLE_HEADER_KEYS);
    expect(picked?.table.sheetName).toBe("Hacienda");
    expect(picked?.table.headers).toEqual(["Categoría", "Cantidad", "Potrero", "Nacimiento"]);
    expect(picked?.table.rows).toEqual([["Vacas de cría", "120", "Bajo", "2024-03-05"]]);
  });

  it("explains unsupported files", async () => {
    await expect(readSpreadsheetFile(new File(["x"], "viejo.xls"))).rejects.toBeInstanceOf(SpreadsheetReadError);
    await expect(readSpreadsheetFile(new File(["x"], "doc.pdf", { type: "application/pdf" }))).rejects.toThrow("Excel (.xlsx) o CSV");
    await expect(readSpreadsheetFile(new File(["no es zip"], "roto.xlsx"))).rejects.toThrow("No se pudo leer el Excel");
    await expect(readSpreadsheetFile(new File([new Uint8Array(2_000_001)], "grande.csv"))).rejects.toThrow("2 MB");
  });
});

describe("fitWithin", () => {
  it("shrinks the long side to the limit and never upscales", () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3000, 4000)).toEqual({ width: 1200, height: 1600 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(0, 600)).toEqual({ width: 0, height: 0 });
  });
});
