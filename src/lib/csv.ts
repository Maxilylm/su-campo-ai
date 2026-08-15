// Pure CSV serialization — no DB/IO, so it's unit-testable.
// Columns are the union of keys across rows (stable first-seen order).

function cell(v: unknown): string {
  if (v == null) return "";
  const raw = typeof v === "object" ? JSON.stringify(v) : String(v);
  // Spreadsheet programs may execute user-entered values beginning with
  // formula markers. Keep the visible value but force it to remain text.
  const s = typeof raw === "string" && /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
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

function detectDelimiter(source: string): string {
  const counts = new Map([[",", 0], [";", 0], ["\t", 0]]);
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === "\n" || char === "\r") break;
    if (char === '"') {
      if (quoted && source[index + 1] === '"') { index += 1; continue; }
      quoted = !quoted;
      continue;
    }
    if (!quoted && counts.has(char)) counts.set(char, counts.get(char)! + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0][0];
}

/** Parse a small user-selected CSV without relying on a browser-only API. */
export function parseCSV(input: string, delimiter?: string): ParsedCSV {
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

  const [headerRow = [], ...dataRows] = rows;
  const headers = headerRow.map((header) => header.trim());
  return {
    headers,
    rows: dataRows.map((dataRow) => headers.map((_, index) => (dataRow[index] || "").trim())),
  };
}
