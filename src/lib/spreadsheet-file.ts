// Read a user-picked spreadsheet (CSV or .xlsx) into sheet grids in the
// browser. The xlsx reader is loaded on demand so pages that never import
// don't ship it.
import { parseCSVRows } from "./csv";
import type { SheetGrid } from "./import-table";

export const MAX_SPREADSHEET_BYTES = 2_000_000;
export const SPREADSHEET_ACCEPT = ".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export type SpreadsheetKind = "csv" | "xlsx" | "xls" | "image" | "unknown";

/** Classify a picked file by extension first (mobile browsers often send an empty MIME type). */
export function spreadsheetKind(name: string, type: string): SpreadsheetKind {
  const lower = name.toLowerCase();
  if (lower.endsWith(".csv") || lower.endsWith(".txt") || type === "text/csv") return "csv";
  if (lower.endsWith(".xlsx") || lower.endsWith(".xlsm") || type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") return "xlsx";
  if (lower.endsWith(".xls") || type === "application/vnd.ms-excel") return "xls";
  if (type.startsWith("image/") || /\.(jpe?g|png|webp|heic|heif)$/.test(lower)) return "image";
  return "unknown";
}

export class SpreadsheetReadError extends Error {}

/** Every sheet of the file as raw cell rows. Throws SpreadsheetReadError with a Spanish message. */
export async function readSpreadsheetFile(file: File): Promise<SheetGrid[]> {
  const kind = spreadsheetKind(file.name, file.type);
  if (file.size > MAX_SPREADSHEET_BYTES) throw new SpreadsheetReadError("El archivo supera el límite de 2 MB.");
  if (kind === "xls") throw new SpreadsheetReadError("Los archivos .xls (Excel 97-2003) no se pueden leer. Guardalo como .xlsx o CSV desde Excel.");
  if (kind === "csv") return [{ name: file.name, rows: parseCSVRows(await file.text()) }];
  if (kind !== "xlsx") throw new SpreadsheetReadError("Elegí un archivo Excel (.xlsx) o CSV.");
  try {
    const { default: readXlsxFile } = await import("read-excel-file/browser");
    const sheets = await readXlsxFile(file);
    return sheets.map((sheet) => ({ name: sheet.sheet, rows: sheet.data as SheetGrid["rows"] }));
  } catch {
    throw new SpreadsheetReadError("No se pudo leer el Excel. Verificá que no tenga contraseña o guardalo como CSV.");
  }
}
