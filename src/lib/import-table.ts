// Spreadsheet grid → import table. Pure: works on the cell arrays that
// read-excel-file (xlsx) or parseCSVRows (csv) produce, so the header
// detection and sheet choice are unit-testable without a browser.
import { parseLocalizedNumber } from "./number";

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
    // Integers verbatim: a 15-digit caravana stored as a number must not be rounded.
    if (Number.isInteger(value)) return Math.abs(value) < 1e21 ? value.toFixed(0) : "";
    // Drop binary noise such as 420.49999999999994, and write the decimal
    // comma so "2.125" can only ever mean two thousand one hundred twenty-five.
    return String(Number(value.toPrecision(12))).replace(".", ",");
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

/**
 * True for "Total", "Totales", "Subtotal vacunos", "Total general:" rows that
 * summarize the ones above. Only the whole first cell counts, so an item
 * called "Total Quartz 5W30" (a lubricant) is not a summary.
 */
export function isSummaryRow(row: string[]): boolean {
  const first = row.find((cell) => cell.trim() !== "");
  if (first === undefined) return false;
  return /^(sub ?)?total(es)?( (general|gral\.?|vacunos|bovinos|ovinos|equinos|hacienda|cabezas|stock|insumos))?\s*:?$/.test(plainText(first));
}

/** Index of the first header whose normalized text is one of `aliases`, or -1. */
export function findColumn(headers: string[], aliases: readonly string[]): number {
  return headers.findIndex((header) => aliases.includes(normalizeHeaderKey(header)));
}

/** Lowercase, accent-free text with single spaces, for value matching ("Vacas de cría" → "vacas de cria"). */
export function plainText(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
}

/** Trimmed cell of a row at a mapped column ("" when the column is not mapped). */
export function cellAt(row: string[], index: number | undefined): string {
  return index === undefined || index < 0 ? "" : (row[index] ?? "").trim();
}

export function textOrNull(value: string): string | null {
  const text = value.trim();
  return text ? text : null;
}

const NUMBER_PATTERN = /-?\d+(?:[ \u00a0]\d{3})*(?:[.,]\d+)*/;

export interface NumberCellParts {
  /** The first number in the cell, spaces removed ("1 250" → "1250"); "" when there is none. */
  number: string;
  /** Whatever else the cell says ("kg", "$U", "bolsas de 25 kg"). */
  rest: string;
}

/** Split "U$S 12,50" into "12,50" and "U$S". A blank or a dash is empty. */
export function splitNumberCell(value: string): NumberCellParts {
  const text = value.trim();
  if (/^[-–—]?$/.test(text)) return { number: "", rest: "" };
  const match = NUMBER_PATTERN.exec(text);
  if (!match) return { number: "", rest: text };
  const rest = `${text.slice(0, match.index)} ${text.slice(match.index + match[0].length)}`.replace(/\s+/g, " ").trim();
  return { number: match[0].replace(/[ \u00a0]/g, ""), rest };
}

/**
 * A numeric cell reduced to its number when the only other text is
 * something the caller understands (`acceptRest`: a unit, a currency);
 * otherwise the cell is returned unchanged so validation shows it instead
 * of silently keeping "10" out of "10 bolsas de 25 kg". "" for blank or dash.
 */
export function numberCell(value: string, acceptRest: (rest: string) => boolean = () => false): string {
  const text = value.trim();
  const { number, rest } = splitNumberCell(text);
  if (!number) return rest;
  return !rest || acceptRest(rest) ? number : text;
}

const AMBIGUOUS_NUMBER = /^-?[1-9]\d{0,2}\.\d{3}$/;

/** "1.125": a dot and exactly three digits is 1125 in Uruguay but 1.125 in an export or a JSON number. */
export function isAmbiguousNumber(value: string): boolean {
  return AMBIGUOUS_NUMBER.test(value.trim().replace(/[\s\u00a0]/g, ""));
}

/**
 * Parse an imported number: "1.250.000" and "1.250,5" use dots for
 * thousands, "420,5" and "420.5" are decimals. A single "1.125" is ambiguous
 * and parses as NaN, so the preview asks instead of guessing ×1000.
 */
export function parseImportNumber(value: string): number {
  const text = value.trim().replace(/[\s\u00a0]/g, "");
  if (/^-?[1-9]\d{0,2}(\.\d{3}){2,}$/.test(text)) return Number(text.replace(/\./g, ""));
  if (AMBIGUOUS_NUMBER.test(text)) return Number.NaN;
  return parseLocalizedNumber(text);
}

export type DecimalStyle = "dot" | "comma" | "unknown";

/**
 * How a column writes decimals, from its unambiguous values: "420.5" or
 * "0.125" mean dot decimals, "420,5" or "1.250.000" mean comma decimals with
 * dot thousands. Mixed or no evidence is "unknown".
 */
export function decimalStyleOf(values: readonly string[]): DecimalStyle {
  let dot = false;
  let comma = false;
  for (const raw of values) {
    const value = raw.trim().replace(/[\s\u00a0]/g, "");
    if (/^-?\d+\.\d{1,2}$/.test(value) || /^-?\d+\.\d{4,}$/.test(value) || /^-?0\.\d+$/.test(value) || /^-?\d{4,}\.\d+$/.test(value)) dot = true;
    if (/^-?\d+,\d+$/.test(value) || /^-?\d{1,3}(\.\d{3})+,\d+$/.test(value) || /^-?[1-9]\d{0,2}(\.\d{3}){2,}$/.test(value)) comma = true;
  }
  return dot && !comma ? "dot" : comma && !dot ? "comma" : "unknown";
}

/** Rewrite an ambiguous "1.125" for a column whose style is known ("1,125" or "1125"); otherwise unchanged. */
export function resolveAmbiguousNumber(value: string, style: DecimalStyle): string {
  if (!isAmbiguousNumber(value)) return value;
  const text = value.trim().replace(/[\s\u00a0]/g, "");
  if (style === "dot") return text.replace(".", ",");
  if (style === "comma") return text.replace(".", "");
  return value;
}

/** Headers of the app's own CSV export (snake_case DB columns): numbers there use dot decimals. */
const EXPORT_HEADERS = new Set(["current_stock", "min_stock", "cost_per_unit", "weight_kg"]);

/** Decimal style of a numeric column: forced "dot" for the app's export, else inferred from its values. */
export function columnDecimalStyle(table: ImportTable, values: readonly string[]): DecimalStyle {
  if (table.headers.some((header) => EXPORT_HEADERS.has(header.trim().toLowerCase()))) return "dot";
  return decimalStyleOf(values);
}

/** Validation text for a number that could not be read, with a hint for the "1.125" case. */
export function numberProblem(label: string, value: string): string {
  const text = value.trim();
  if (isAmbiguousNumber(text)) {
    const plain = text.replace(/[\s\u00a0]/g, "");
    return `${label}: «${text}» es ambiguo; escribí ${plain.replace(".", "")} o ${plain.replace(".", ",")}.`;
  }
  return `${label}: «${text}» no es un número válido.`;
}
