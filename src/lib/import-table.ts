// Spreadsheet grid → import table. Pure: works on the cell arrays that
// read-excel-file (xlsx) or parseCSVRows (csv) produce, so the header
// detection and sheet choice are unit-testable without a browser.

/** A cell as read-excel-file returns it (or a CSV string). */
export type SheetCell = string | number | boolean | Date | null | undefined;

export interface SheetGrid {
  name: string;
  rows: SheetCell[][];
}

export interface ImportTable {
  /** Header texts; blank header cells become "Columna N". */
  headers: string[];
  /** Data rows below the header, each padded to `headers.length`. */
  rows: string[][];
  /** 0-based index of the header row inside the (blank-row-free) grid. */
  headerRowIndex: number;
  sheetName: string | null;
}

/** How far down a sheet a header row is looked for (titles, farm name, date…). */
export const HEADER_SCAN_ROWS = 15;
/** Hard cap on columns kept from a sheet; wider sheets are almost certainly not a register. */
export const MAX_TABLE_COLUMNS = 60;

/** Lowercase, accent-free, alphanumeric-only key used to compare header texts. */
export function normalizeHeaderKey(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Render one cell as the text a CSV would have had. Dates become AAAA-MM-DD. */
export function cellToText(value: SheetCell): string {
  if (value == null) return "";
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) return "";
    // read-excel-file builds dates in UTC from the serial day number.
    return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "";
    // Drop binary noise such as 420.49999999999994 without rounding real decimals.
    return String(Number(value.toPrecision(12)));
  }
  if (typeof value === "boolean") return value ? "sí" : "no";
  return String(value).replace(/\s+/g, " ").trim();
}

/** Text grid without fully blank rows and without trailing blank columns. */
export function gridToText(rows: SheetCell[][]): string[][] {
  const text = rows
    .map((row) => (Array.isArray(row) ? row : []).slice(0, MAX_TABLE_COLUMNS).map(cellToText))
    .filter((row) => row.some((cell) => cell !== ""));
  let width = 0;
  for (const row of text) {
    for (let index = row.length - 1; index >= 0; index -= 1) {
      if (row[index] !== "") { width = Math.max(width, index + 1); break; }
    }
  }
  return text.map((row) => Array.from({ length: width }, (_, index) => row[index] ?? ""));
}

function isNumericText(value: string): boolean {
  return /^[-+]?[\d.,\s]+$/.test(value) && /\d/.test(value);
}

/** How many cells of `row` match a known header alias. */
export function headerScore(row: string[], aliases: ReadonlySet<string>): number {
  return row.reduce((score, cell) => score + (cell && aliases.has(normalizeHeaderKey(cell)) ? 1 : 0), 0);
}

/**
 * Index of the header row: the row in the first HEADER_SCAN_ROWS with the most
 * known column names; when none matches, the first row with at least two
 * non-numeric cells followed by another row (a title line has one cell).
 */
export function detectHeaderRow(grid: string[][], aliases: ReadonlySet<string>): number {
  const limit = Math.min(grid.length, HEADER_SCAN_ROWS);
  let best = -1;
  let bestScore = 0;
  for (let index = 0; index < limit; index += 1) {
    const score = headerScore(grid[index], aliases);
    if (score > bestScore) { best = index; bestScore = score; }
  }
  if (best >= 0) return best;
  for (let index = 0; index < limit; index += 1) {
    const textual = grid[index].filter((cell) => cell !== "" && !isNumericText(cell)).length;
    if (textual >= 2 && index + 1 < grid.length) return index;
  }
  return 0;
}

/** Split a text grid into headers and data rows around the detected header row. */
export function tableFromGrid(grid: string[][], aliases: ReadonlySet<string>, sheetName: string | null = null): ImportTable {
  if (grid.length === 0) return { headers: [], rows: [], headerRowIndex: 0, sheetName };
  const headerRowIndex = detectHeaderRow(grid, aliases);
  const width = grid.reduce((max, row) => Math.max(max, row.length), 0);
  const headerRow = grid[headerRowIndex];
  const headers = Array.from({ length: width }, (_, index) => (headerRow[index] || "").trim() || `Columna ${index + 1}`);
  const rows = grid.slice(headerRowIndex + 1).map((row) => headers.map((_, index) => (row[index] ?? "").trim()));
  return { headers, rows, headerRowIndex, sheetName };
}

export interface PickedSheet {
  table: ImportTable;
  sheetNames: string[];
}

/**
 * Choose the sheet that looks most like a register: most recognized headers,
 * then most data rows. Sheets with no data are skipped; returns null when
 * every sheet is empty.
 */
export function pickSheet(sheets: SheetGrid[], aliases: ReadonlySet<string>, preferredName?: string | null): PickedSheet | null {
  const sheetNames = sheets.map((sheet) => sheet.name);
  let best: { table: ImportTable; score: number } | null = null;
  for (const sheet of sheets) {
    const grid = gridToText(sheet.rows);
    if (grid.length === 0) continue;
    const table = tableFromGrid(grid, aliases, sheet.name);
    if (preferredName && sheet.name === preferredName) return { table, sheetNames };
    const score = headerScore(table.headers, aliases) * 1000 + Math.min(table.rows.length, 999);
    if (!best || score > best.score) best = { table, score };
  }
  return best ? { table: best.table, sheetNames } : null;
}

/** True for "Total", "Subtotal", "Totales" rows that summarize the ones above. */
export function isSummaryRow(row: string[]): boolean {
  const first = row.find((cell) => cell.trim() !== "");
  return first !== undefined && /^(sub)?\s*total(es)?\b/i.test(first.normalize("NFD").replace(/[̀-ͯ]/g, "").trim());
}
