// Pure CSV serialization — no DB/IO, so it's unit-testable.
// Columns are the union of keys across rows (stable first-seen order).

function cell(v: unknown): string {
  if (v == null) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const cols: string[] = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!cols.includes(k)) cols.push(k);
  const header = cols.map(cell).join(",");
  const body = rows.map((r) => cols.map((c) => cell(r[c])).join(","));
  return [header, ...body].join("\n");
}
