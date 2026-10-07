// Pure CSV serialization — no DB/IO, so it's unit-testable.
// Columns are the union of keys across rows (stable first-seen order).

function cell(v: unknown): string {
  if (v == null) return "";
  const raw = typeof v === "object" ? JSON.stringify(v) : String(v);
  // Spreadsheet programs may execute user-entered *string* values beginning
  // with formula markers (including tab/CR, which some parsers also treat as
  // a leading marker). Numbers are our own data (e.g. -500) and must not be
  // quoted into text, or they stop being numeric in the sheet.
  const s = typeof v === "string" && /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const cols: string[] = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!cols.includes(k)) cols.push(k);
  const header = cols.map(cell).join(",");
  const body = rows.map((r) => cols.map((c) => cell(r[c])).join(","));
  // BOM makes UTF-8 accents render correctly in Excel on Windows.
  return "\uFEFF" + [header, ...body].join("\n");
}

export interface ParsedCSV {
  headers: string[];
  rows: string[][];
}

// The separator is the one used the same number of times on the most of the
// first lines (ties: more columns). Counting a single line breaks on title
// lines ("Hacienda, campo Las Rosas" above ';' rows) and on decimal commas.
const DELIMITER_SCAN_LINES = 10;
const DELIMITERS = [",", ";", "\t"] as const;

function detectDelimiter(source: string): string {
  const lines: Record<string, number>[] = [];
  let counts: Record<string, number> = { ",": 0, ";": 0, "\t": 0 };
  let quoted = false;
  let hasText = false;
  for (let index = 0; index < source.length && lines.length < DELIMITER_SCAN_LINES; index += 1) {
    const char = source[index];
    if (char === '"') {
      if (quoted && source[index + 1] === '"') { index += 1; continue; }
      quoted = !quoted;
      hasText = true;
      continue;
    }
    if (!quoted && (char === "\n" || char === "\r")) {
      if (hasText) lines.push(counts);
      counts = { ",": 0, ";": 0, "\t": 0 };
      hasText = false;
      continue;
    }
    if (!quoted && char in counts) counts[char] += 1;
    if (char.trim()) hasText = true;
  }
  if (hasText && lines.length < DELIMITER_SCAN_LINES) lines.push(counts);

  let best: { delimiter: string; lines: number; columns: number } = { delimiter: ",", lines: 0, columns: 0 };
  for (const delimiter of DELIMITERS) {
    const frequency = new Map<number, number>();
    for (const line of lines) {
      if (line[delimiter] > 0) frequency.set(line[delimiter], (frequency.get(line[delimiter]) ?? 0) + 1);
    }
    for (const [columns, count] of frequency) {
      if (count > best.lines || (count === best.lines && columns > best.columns)) best = { delimiter, lines: count, columns };
    }
  }
  return best.delimiter;
}

/** Parse a small user-selected CSV into raw rows (blank lines dropped, no header handling). */
export function parseCSVRows(input: string, delimiter?: string): string[][] {
  const source = input.replace(/^\uFEFF/, "");
  const separator = delimiter || detectDelimiter(source);
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          value += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        value += char;
      }
      continue;
    }
    if (char === '"' && value.length === 0) {
      quoted = true;
    } else if (char === separator) {
      row.push(value);
      value = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      row.push(value);
      value = "";
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
    } else {
      value += char;
    }
  }
  if (quoted || value.length > 0 || row.length > 0) {
    row.push(value);
    if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  }

  return rows;
}

/** Parse a small user-selected CSV without relying on a browser-only API. */
export function parseCSV(input: string, delimiter?: string): ParsedCSV {
  const [headerRow = [], ...dataRows] = parseCSVRows(input, delimiter);
  const headers = headerRow.map((header) => header.trim());
  return {
    headers,
    rows: dataRows.map((dataRow) => headers.map((_, index) => (dataRow[index] || "").trim())),
  };
}
