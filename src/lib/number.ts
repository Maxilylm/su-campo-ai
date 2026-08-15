/** Parse spreadsheet numbers written with either dot or comma conventions. */
export function parseLocalizedNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (value == null) return Number.NaN;
  const raw = String(value).trim().replace(/[\s\u00a0]/g, "");
  if (!raw) return Number.NaN;

  const comma = raw.lastIndexOf(",");
  const dot = raw.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    return Number(comma > dot ? raw.replace(/\./g, "").replace(",", ".") : raw.replace(/,/g, ""));
  }
  return Number(comma >= 0 ? raw.replace(",", ".") : raw);
}
