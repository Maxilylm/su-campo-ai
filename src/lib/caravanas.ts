// Caravanas (official SNIG ear tags): pure logic shared by the Caravanas page,
// its API routes and the assistant context. No DB or browser access here.
//
// Uruguay's SNIG identifies each bovine by a 15-digit ISO 11784 number whose
// first three digits are the country code (858 = Uruguay). The visual tag
// prints "UY" and the national number (its last digits), so "UY 012345678"
// and "858000012345678" are the same animal. Everything is stored in the
// 15-digit form.

import { CATTLE_CATEGORIES } from "./cattle";

export const UY_COUNTRY_CODE = "858";
export const CARAVANA_STATUSES = ["activo", "vendido", "muerto", "faltante"] as const;
export type CaravanaStatus = (typeof CARAVANA_STATUSES)[number];
export const CARAVANA_SEXES = ["macho", "hembra"] as const;
export type CaravanaSex = (typeof CARAVANA_SEXES)[number];
export const CARAVANA_SOURCES = ["manual", "snig_import", "excel"] as const;
export type CaravanaSource = (typeof CARAVANA_SOURCES)[number];
export type CaravanaCategory = (typeof CATTLE_CATEGORIES)[number];

export const CARAVANA_STATUS_LABELS: Record<CaravanaStatus, string> = {
  activo: "Activo",
  vendido: "Vendido",
  muerto: "Muerto",
  faltante: "Faltante",
};

export const CARAVANA_SEX_LABELS: Record<CaravanaSex, string> = { macho: "Macho", hembra: "Hembra" };

export const MAX_CARAVANA_IMPORT_ROWS = 5000;
export const CARAVANAS_MIGRATION_FILE = "supabase/054_caravanas.sql";
export const SNIG_PORTAL_URL = "https://www.snig.gub.uy/";

export function isCaravanaStatus(value: unknown): value is CaravanaStatus {
  return typeof value === "string" && (CARAVANA_STATUSES as readonly string[]).includes(value);
}

export function isCaravanaSex(value: unknown): value is CaravanaSex {
  return typeof value === "string" && (CARAVANA_SEXES as readonly string[]).includes(value);
}

export function isCaravanaCategory(value: unknown): value is CaravanaCategory {
  return typeof value === "string" && (CATTLE_CATEGORIES as readonly string[]).includes(value);
}

export type CaravanaParseResult =
  | { ok: true; tag: string; foreign: boolean }
  | { ok: false; reason: string };

/**
 * Normalize a caravana as written anywhere (SNIG export, Excel number, typed
 * by hand) to the 15-digit form.
 *
 * Accepted: "858000012345678", "858 0000 1234 5678", "858-000012345678",
 * "UY 012345678", "UY-0123-45678", "uy012345678", a bare national number of
 * 6–12 digits ("012345678"), and Excel numbers (858000012345678).
 * A 15-digit number with another country code is accepted as foreign.
 */
export function normalizeCaravana(value: unknown): CaravanaParseResult {
  let raw: string;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) return { ok: false, reason: "no es un número de caravana" };
    raw = String(value);
  } else if (typeof value === "string") {
    raw = value;
  } else {
    return { ok: false, reason: "falta la caravana" };
  }
  const compact = raw.normalize("NFKC").toUpperCase().replace(/[\s\-._/]/g, "");
  if (!compact) return { ok: false, reason: "falta la caravana" };

  const hasUyPrefix = compact.startsWith("UY");
  const digits = hasUyPrefix ? compact.slice(2) : compact;
  if (!/^\d+$/.test(digits)) return { ok: false, reason: `«${raw.trim().slice(0, 30)}» no es una caravana oficial (solo dígitos, con o sin UY)` };

  if (digits.length === 15) {
    if (hasUyPrefix && !digits.startsWith(UY_COUNTRY_CODE)) {
      return { ok: false, reason: `«${raw.trim().slice(0, 30)}» tiene UY pero no empieza con 858` };
    }
    return { ok: true, tag: digits, foreign: !digits.startsWith(UY_COUNTRY_CODE) };
  }
  if (digits.length >= 6 && digits.length <= 12) {
    return { ok: true, tag: UY_COUNTRY_CODE + digits.padStart(12, "0"), foreign: false };
  }
  return { ok: false, reason: `«${raw.trim().slice(0, 30)}» no tiene 15 dígitos (858…) ni es un número UY` };
}

/** "858000012345678" → "UY 012345678" (national number, at least 9 digits). */
export function caravanaVisual(tag: string): string {
  if (!/^\d{15}$/.test(tag)) return tag;
  if (!tag.startsWith(UY_COUNTRY_CODE)) return `${tag.slice(0, 3)} ${tag.slice(3)}`;
  const national = tag.slice(3).replace(/^0+/, "").padStart(9, "0");
  return `UY ${national}`;
}

/** "858000012345678" → "858 000012345678", the usual reader display. */
export function caravanaDisplay(tag: string): string {
  return /^\d{15}$/.test(tag) ? `${tag.slice(0, 3)} ${tag.slice(3)}` : tag;
}

/** Search text → candidate tag fragment (digits only), for matching typed numbers. */
export function caravanaSearchDigits(query: string): string {
  return query.normalize("NFKC").toUpperCase().replace(/^\s*UY/, "").replace(/\D/g, "");
}

function plainKey(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** undefined = value present but not understood. */
export function normalizeCaravanaSex(value: unknown): CaravanaSex | null | undefined {
  const key = plainKey(value);
  if (!key) return null;
  if (["m", "macho", "machos", "male", "masculino"].includes(key)) return "macho";
  if (["h", "f", "hembra", "hembras", "female", "femenino"].includes(key)) return "hembra";
  return undefined;
}

/** undefined = value present but not understood. */
export function normalizeCaravanaStatus(value: unknown): CaravanaStatus | null | undefined {
  const key = plainKey(value);
  if (!key) return null;
  if (["activo", "activa", "vivo", "viva", "enstock", "stock", "existencia", "presente", "alta"].includes(key)) return "activo";
  if (["vendido", "vendida", "venta", "bajaporventa", "faena", "faenado", "faenada", "exportado", "exportada", "egreso"].includes(key)) return "vendido";
  if (["muerto", "muerta", "muerte", "bajapormuerte", "mortandad", "fallecido"].includes(key)) return "muerto";
  if (["faltante", "perdido", "perdida", "extraviado", "extraviada", "robo", "abigeato", "nolocalizado"].includes(key)) return "faltante";
  return undefined;
}

/**
 * SNIG/DICOSE category words → the app's lote categories. Unknown words are
 * null (the animal is still imported, without category). `sex` disambiguates
 * "terneros/as".
 */
export function normalizeCaravanaCategory(value: unknown, sex?: CaravanaSex | null): CaravanaCategory | null {
  const key = plainKey(value);
  if (!key) return null;
  if (isCaravanaCategory(key)) return key;
  if (key.startsWith("ternera")) return "ternera";
  if (key.startsWith("ternero")) {
    if (key === "ternero" || key === "terneros") return sex === "hembra" ? "ternera" : "ternero";
    // "Terneros/as", "ternero/a": only the sex can tell.
    return sex === "hembra" ? "ternera" : sex === "macho" ? "ternero" : null;
  }
  if (key.startsWith("novillo") || key.startsWith("buey") || key.startsWith("novillito")) return "novillo";
  if (key.startsWith("vaquillona") || key.startsWith("vaq")) return "vaquillona";
  if (key.startsWith("vaca")) return "vaca";
  if (key.startsWith("toro") || key.startsWith("torito")) return "toro";
  return null;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function validYmd(year: number, month: number, day: number): string | undefined {
  if (year < 1980 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/**
 * Birth dates as SNIG and Excel give them → "YYYY-MM-DD". Accepts Date cells,
 * Excel serial numbers, DD/MM/YYYY (also with - or .), DD/MM/YY, YYYY-MM-DD
 * and MM/YYYY (SNIG often records only the birth month → day 1).
 * null = empty; undefined = present but not a date.
 */
export function parseCaravanaDate(value: unknown): string | null | undefined {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return undefined;
    // Excel dates are calendar days at UTC midnight in read-excel-file.
    return validYmd(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
  }
  if (typeof value === "number") {
    // Excel serial day (1900 system): 25569 = 1970-01-01.
    if (!Number.isInteger(value) || value < 29221 || value > 73050) return undefined;
    const date = new Date((value - 25569) * 86_400_000);
    return validYmd(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (!text) return null;
  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/);
  if (match) return validYmd(Number(match[1]), Number(match[2]), Number(match[3]));
  match = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (match) {
    const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
    return validYmd(year, Number(match[2]), Number(match[1]));
  }
  match = text.match(/^(\d{1,2})[/.-](\d{4})$/);
  if (match) return validYmd(Number(match[2]), Number(match[1]), 1);
  return undefined;
}

export type DicoseResult = { ok: true; value: string | null } | { ok: false; reason: string };

/** Número DICOSE: digits only (separators dropped), 4–15 digits, or empty. */
export function normalizeDicose(value: unknown): DicoseResult {
  if (value == null) return { ok: true, value: null };
  if (typeof value !== "string" && typeof value !== "number") return { ok: false, reason: "Número DICOSE inválido." };
  const text = String(value).trim();
  if (!text) return { ok: true, value: null };
  const digits = text.replace(/[\s.\-/]/g, "");
  if (!/^\d{4,15}$/.test(digits)) return { ok: false, reason: "El número DICOSE debe tener solo dígitos (entre 4 y 15)." };
  return { ok: true, value: digits };
}

// ── Spreadsheet parsing ────────────────────────────────────────────────────

export type SheetCell = string | number | boolean | Date | null | undefined;
export type SheetRow = SheetCell[];

const HEADER_ALIASES = {
  tag: [
    "nrodispositivo", "nrodedispositivo", "numerodispositivo", "numerodedispositivo", "dispositivo", "iddispositivo",
    "caravana", "caravanas", "nrocaravana", "nrodecaravana", "numerocaravana", "numerodecaravana", "caravanaelectronica",
    "caravanaoficial", "identificador", "identificacion", "nroidentificacion", "idelectronico", "rfid", "eid", "eartag",
    "tag", "tagnumber", "chip",
  ],
  visual: ["caravanavisual", "visual", "nrovisual", "idvisual", "numerovisual"],
  sex: ["sexo", "sex"],
  breed: ["raza", "breed", "razas"],
  cross: ["cruza", "cruce", "cruzas"],
  birthDate: [
    "fechanac", "fechanacimiento", "fechadenacimiento", "fnac", "fnacimiento", "nacimiento", "fechanacim",
    "mesanonacimiento", "mesnacimiento", "birthdate",
  ],
  category: ["categoria", "category", "cat", "categorias"],
  status: ["estado", "status", "situacion"],
  notes: ["notas", "observaciones", "obs", "observacion", "notes", "comentarios"],
} as const;

type ColumnKey = keyof typeof HEADER_ALIASES;
export type CaravanaColumns = Record<ColumnKey, number>;

function cellText(cell: SheetCell): string {
  if (cell == null) return "";
  if (cell instanceof Date) return Number.isNaN(cell.getTime()) ? "" : cell.toISOString().slice(0, 10);
  return String(cell).trim();
}

function findColumns(row: SheetRow): CaravanaColumns {
  const keys = row.map((cell) => plainKey(cellText(cell)));
  const columns = {} as CaravanaColumns;
  for (const [name, aliases] of Object.entries(HEADER_ALIASES) as [ColumnKey, readonly string[]][]) {
    columns[name] = keys.findIndex((key) => key !== "" && aliases.includes(key));
  }
  // "Caravana visual" must not also be the electronic column.
  if (columns.tag >= 0 && columns.tag === columns.visual) columns.visual = -1;
  return columns;
}

export interface CaravanaImportRow {
  /** 1-based line in the source file. */
  line: number;
  tagNumber: string;
  visualTag: string | null;
  sex: CaravanaSex | null;
  breed: string | null;
  category: CaravanaCategory | null;
  birthDate: string | null;
  status: CaravanaStatus | null;
  notes: string | null;
}

export interface CaravanaIssue {
  line: number;
  message: string;
}

export interface CaravanaSheetResult {
  rows: CaravanaImportRow[];
  errors: CaravanaIssue[];
  warnings: CaravanaIssue[];
  /** Lines dropped because their caravana already appeared earlier in the file. */
  duplicates: CaravanaIssue[];
  /** A problem with the whole file (no caravana column, too many rows): nothing can be imported. */
  fatal: string | null;
  headerLine: number | null;
  columns: CaravanaColumns | null;
  /** The header names SNIG's "dispositivo" column (an export from SNIG rather than a home-made sheet). */
  snigLayout: boolean;
  totalDataRows: number;
}

function limitText(value: string, max: number): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function breedWithCross(breed: string, cross: string): string | null {
  const crossKey = plainKey(cross);
  if (!cross || ["no", "n", "0", "false", "pura", "puro"].includes(crossKey)) return limitText(breed, 100);
  if (["si", "s", "1", "true", "x"].includes(crossKey)) return limitText(breed ? `${breed} (cruza)` : "Cruza", 100);
  if (!breed) return limitText(`Cruza ${cross}`, 100);
  return limitText(`${breed} x ${cross}`, 100);
}

/**
 * Parse a SNIG/DICOSE listing (CSV or the first Excel sheet as a grid of
 * cells). The header row is found among the first 20 rows (exports often
 * start with title lines); data rows without any caravana are skipped.
 */
export function parseCaravanaSheet(grid: SheetRow[], maxRows = MAX_CARAVANA_IMPORT_ROWS): CaravanaSheetResult {
  const result: CaravanaSheetResult = { rows: [], errors: [], warnings: [], duplicates: [], fatal: null, headerLine: null, columns: null, snigLayout: false, totalDataRows: 0 };
  let headerIndex = -1;
  let columns: CaravanaColumns | null = null;
  for (let index = 0; index < Math.min(grid.length, 20); index += 1) {
    const candidate = findColumns(grid[index] || []);
    if (candidate.tag >= 0 || candidate.visual >= 0) {
      headerIndex = index;
      columns = candidate;
      break;
    }
  }
  if (!columns) {
    result.fatal = "No encontré la columna de caravana (por ejemplo «Nro. Dispositivo», «Caravana» o «Identificador»).";
    return result;
  }
  result.headerLine = headerIndex + 1;
  result.columns = columns;
  result.snigLayout = columns.tag >= 0 && plainKey(cellText(grid[headerIndex][columns.tag])).includes("dispositivo");
  const seen = new Map<string, number>();
  const tagColumn = columns.tag >= 0 ? columns.tag : columns.visual;

  for (let index = headerIndex + 1; index < grid.length; index += 1) {
    const row = grid[index] || [];
    const line = index + 1;
    if (row.every((cell) => cellText(cell) === "")) continue;
    const rawTag = row[tagColumn];
    const rawTagText = cellText(rawTag);
    const visualText = columns.visual >= 0 ? cellText(row[columns.visual]) : "";
    if (!rawTagText && !visualText) continue;
    result.totalDataRows += 1;
    if (result.rows.length + result.duplicates.length >= maxRows) continue;

    const parsedTag = normalizeCaravana(rawTagText ? (typeof rawTag === "number" ? rawTag : rawTagText) : visualText);
    if (!parsedTag.ok) {
      result.errors.push({ line, message: `Fila ${line}: ${parsedTag.reason}.` });
      continue;
    }
    const previous = seen.get(parsedTag.tag);
    if (previous) {
      result.duplicates.push({ line, message: `Fila ${line}: la caravana ${caravanaDisplay(parsedTag.tag)} ya aparece en la fila ${previous}; se importa una sola vez.` });
      continue;
    }
    seen.set(parsedTag.tag, line);
    if (parsedTag.foreign) {
      result.warnings.push({ line, message: `Fila ${line}: la caravana ${caravanaDisplay(parsedTag.tag)} no es uruguaya (no empieza con 858).` });
    }

    const sexText = columns.sex >= 0 ? cellText(row[columns.sex]) : "";
    let sex = normalizeCaravanaSex(sexText);
    if (sex === undefined) {
      result.warnings.push({ line, message: `Fila ${line}: sexo «${sexText.slice(0, 20)}» no reconocido; queda sin dato.` });
      sex = null;
    }
    const categoryText = columns.category >= 0 ? cellText(row[columns.category]) : "";
    const category = normalizeCaravanaCategory(categoryText, sex);
    if (categoryText && !category) {
      result.warnings.push({ line, message: `Fila ${line}: categoría «${categoryText.slice(0, 30)}» no reconocida; queda sin categoría.` });
    }
    const dateCell = columns.birthDate >= 0 ? row[columns.birthDate] : null;
    const birthDate = parseCaravanaDate(dateCell);
    if (birthDate === undefined) {
      result.errors.push({ line, message: `Fila ${line}: fecha de nacimiento «${cellText(dateCell).slice(0, 20)}» inválida (usá DD/MM/AAAA).` });
      // A later valid line with the same caravana can still be imported.
      seen.delete(parsedTag.tag);
      continue;
    }
    const statusText = columns.status >= 0 ? cellText(row[columns.status]) : "";
    let status = normalizeCaravanaStatus(statusText);
    if (status === undefined) {
      result.warnings.push({ line, message: `Fila ${line}: estado «${statusText.slice(0, 20)}» no reconocido; se mantiene el actual.` });
      status = null;
    }
    const breedText = columns.breed >= 0 ? cellText(row[columns.breed]) : "";
    const crossText = columns.cross >= 0 ? cellText(row[columns.cross]) : "";

    result.rows.push({
      line,
      tagNumber: parsedTag.tag,
      visualTag: visualText ? visualText.slice(0, 40) : null,
      sex,
      breed: breedWithCross(breedText, crossText),
      category,
      birthDate,
      status,
      notes: columns.notes >= 0 ? limitText(cellText(row[columns.notes]), 2000) : null,
    });
  }
  if (result.totalDataRows > maxRows) {
    result.fatal = `El archivo tiene ${result.totalDataRows} caravanas; el máximo por importación es ${maxRows}. Dividilo en partes.`;
  }
  if (result.totalDataRows === 0) {
    result.fatal = "El archivo no tiene filas con caravanas debajo del encabezado.";
  }
  return result;
}

/** CSV text → grid of cells, keeping every row at its own width (title lines included). */
export function csvToGrid(input: string): SheetRow[] {
  const source = input.replace(/^﻿/, "");
  const sampleLines = source.split(/\r?\n/).slice(0, 20);
  const delimiter = [";", ",", "\t"]
    .map((candidate) => ({ candidate, count: Math.max(0, ...sampleLines.map((line) => line.split(candidate).length - 1)) }))
    .sort((a, b) => b.count - a.count)[0].candidate;
  const rows: SheetRow[] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') { value += '"'; index += 1; } else quoted = false;
      } else value += char;
      continue;
    }
    if (char === '"' && value.length === 0) quoted = true;
    else if (char === delimiter) { row.push(value); value = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else value += char;
  }
  if (value.length > 0 || row.length > 0) {
    row.push(value);
    rows.push(row);
  }
  return rows;
}

// ── Server-side validation of an import payload row ───────────────────────

export type ValidatedImportRow = {
  tag_number: string;
  visual_tag: string | null;
  sex: CaravanaSex | null;
  breed: string | null;
  category: CaravanaCategory | null;
  birth_date: string | null;
  status: CaravanaStatus | null;
  notes: string | null;
};

function optionalText(value: unknown, max: number): string | null | undefined {
  if (value == null || value === "") return null;
  if (typeof value !== "string") return undefined;
  return limitText(value, max);
}

/** The client already parsed the file; the API re-checks each row's shape. */
export function validateImportPayloadRow(value: unknown): { ok: true; row: ValidatedImportRow } | { ok: false; reason: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, reason: "formato inválido" };
  const data = value as Record<string, unknown>;
  const tag = normalizeCaravana(data.tagNumber);
  if (!tag.ok) return { ok: false, reason: tag.reason };
  const sex = data.sex == null || data.sex === "" ? null : isCaravanaSex(data.sex) ? data.sex : undefined;
  if (sex === undefined) return { ok: false, reason: "sexo inválido" };
  const category = data.category == null || data.category === "" ? null : isCaravanaCategory(data.category) ? data.category : undefined;
  if (category === undefined) return { ok: false, reason: "categoría inválida" };
  const status = data.status == null || data.status === "" ? null : isCaravanaStatus(data.status) ? data.status : undefined;
  if (status === undefined) return { ok: false, reason: "estado inválido" };
  const birthDate = data.birthDate == null || data.birthDate === "" ? null
    : typeof data.birthDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(data.birthDate) ? parseCaravanaDate(data.birthDate) : undefined;
  if (birthDate === undefined) return { ok: false, reason: "fecha de nacimiento inválida" };
  const visual = optionalText(data.visualTag, 40);
  const breed = optionalText(data.breed, 100);
  const notes = optionalText(data.notes, 2000);
  if (visual === undefined || breed === undefined || notes === undefined) return { ok: false, reason: "texto inválido" };
  return {
    ok: true,
    row: { tag_number: tag.tag, visual_tag: visual, sex, breed, category, birth_date: birthDate, status, notes },
  };
}

// ── Summaries, reconciliation, export, assistant context ──────────────────

export interface CaravanaSummary {
  total: number;
  active: number;
  unassigned: number;
  withoutLote: number;
  byStatus: Record<string, number>;
  byCategory: Record<string, number>;
  bySex: Record<string, number>;
  byCattle: Record<string, number>;
  bySection: Record<string, number>;
}

function countRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  for (const [key, count] of Object.entries(value as Record<string, unknown>)) {
    const n = typeof count === "number" ? count : Number(count);
    if (Number.isFinite(n) && n > 0) out[key] = n;
  }
  return out;
}

function countValue(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** animal_tag_summary() JSON → typed summary (tolerant of missing keys). */
export function parseCaravanaSummary(value: unknown): CaravanaSummary {
  const data = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    total: countValue(data.total),
    active: countValue(data.active),
    unassigned: countValue(data.unassigned),
    withoutLote: countValue(data.without_lote),
    byStatus: countRecord(data.by_status),
    byCategory: countRecord(data.by_category),
    bySex: countRecord(data.by_sex),
    byCattle: countRecord(data.by_cattle),
    bySection: countRecord(data.by_section),
  };
}

/** Category/sex counts of parsed rows (import preview). */
export function summarizeCaravanaRows(rows: Pick<CaravanaImportRow, "category" | "sex">[]) {
  const byCategory: Record<string, number> = {};
  const bySex: Record<string, number> = {};
  for (const row of rows) {
    const category = row.category || "sin_categoria";
    const sex = row.sex || "sin_dato";
    byCategory[category] = (byCategory[category] || 0) + 1;
    bySex[sex] = (bySex[sex] || 0) + 1;
  }
  return { byCategory, bySex };
}

function relatedSectionName(value: unknown): string | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object" || !("name" in row)) return null;
  return typeof row.name === "string" && row.name ? row.name : null;
}

/** A lote (cattle batch) as people name it: "Novillo Angus (Potrero Sur)". */
export function caravanaLoteLabel(value: unknown): string | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") return null;
  const lote = row as { category?: unknown; breed?: unknown; sections?: unknown; sectionName?: unknown };
  const category = typeof lote.category === "string" && lote.category ? categoryLabel(lote.category) : "Lote";
  const breed = typeof lote.breed === "string" && lote.breed ? ` ${lote.breed}` : "";
  const section = typeof lote.sectionName === "string" && lote.sectionName ? lote.sectionName : relatedSectionName(lote.sections);
  return `${category}${breed}${section ? ` (${section})` : ""}`;
}

export function categoryLabel(key: string): string {
  if (key === "sin_categoria") return "Sin categoría";
  return key.charAt(0).toUpperCase() + key.slice(1);
}

export function sexLabel(key: string): string {
  return isCaravanaSex(key) ? CARAVANA_SEX_LABELS[key] : "Sin dato";
}

export interface LoteForReconciliation {
  id: string;
  label: string;
  count: number;
}

export type ReconciliationState = "ok" | "faltan" | "sobran" | "sin_caravanas";

export interface LoteReconciliation extends LoteForReconciliation {
  tagged: number;
  state: ReconciliationState;
  /** count - tagged (positive: heads without a caravana in the registry). */
  difference: number;
}

/** Heads per lote vs active caravanas assigned to it. */
export function reconcileLotes(lotes: LoteForReconciliation[], byCattle: Record<string, number>): LoteReconciliation[] {
  return lotes.map((lote) => {
    const tagged = byCattle[lote.id] || 0;
    const difference = lote.count - tagged;
    const state: ReconciliationState = tagged === 0 ? "sin_caravanas" : difference === 0 ? "ok" : difference > 0 ? "faltan" : "sobran";
    return { ...lote, tagged, difference, state };
  });
}

export function reconciliationText(row: LoteReconciliation): string {
  const heads = `${row.count.toLocaleString("es-UY")} ${row.count === 1 ? "cabeza" : "cabezas"}`;
  const tags = `${row.tagged.toLocaleString("es-UY")} ${row.tagged === 1 ? "caravana asignada" : "caravanas asignadas"}`;
  return `${row.label} tiene ${heads}, ${tags}`;
}

export interface CaravanaExportItem {
  tag_number: string;
  visual_tag: string | null;
  sex: string | null;
  breed: string | null;
  category: string | null;
  birth_date: string | null;
  status: string;
  loteLabel?: string | null;
  sectionName?: string | null;
  notes?: string | null;
}

function ddmmyyyy(value: string | null): string {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "";
}

/**
 * Rows for a SNIG-friendly CSV: the establishment's DICOSE number, the
 * 15-digit device number, the visual tag, sex as M/H, DD/MM/AAAA dates.
 * Useful to fill declaraciones juradas and guías; it is not an official file.
 */
export function caravanasToSnigRows(items: CaravanaExportItem[], dicose: string | null): Record<string, string>[] {
  return items.map((item) => ({
    "DICOSE": dicose || "",
    "Nro. Dispositivo": item.tag_number,
    "Caravana visual": item.visual_tag || caravanaVisual(item.tag_number),
    "Sexo": item.sex === "macho" ? "M" : item.sex === "hembra" ? "H" : "",
    "Raza": item.breed || "",
    "Fecha Nac.": ddmmyyyy(item.birth_date),
    "Categoría": item.category ? categoryLabel(item.category) : "",
    "Estado": isCaravanaStatus(item.status) ? CARAVANA_STATUS_LABELS[item.status] : item.status,
    "Lote": item.loteLabel || "",
    "Potrero": item.sectionName || "",
    "Notas": item.notes || "",
  }));
}

/**
 * Compact CARAVANAS block for the assistant: counts only (no tag numbers), so
 * it stays a few lines whatever the herd size. `escape` is the context's
 * escaper for user-typed lote labels.
 */
export function caravanasAIContext(
  summary: CaravanaSummary,
  lotes: LoteForReconciliation[],
  escape: (value: unknown) => string,
  dicose: string | null = null,
): string {
  if (summary.total === 0) return "";
  const parts = (record: Record<string, number>, label: (key: string) => string) =>
    Object.entries(record).sort((a, b) => b[1] - a[1]).map(([key, n]) => `${label(key)} ${n}`).join(", ");
  let text = "\nCARAVANAS (registro individual SNIG cargado en CampoAI; no es la base oficial del SNIG):\n";
  text += `- ${summary.active} activas de ${summary.total} registradas`;
  const inactive = Object.entries(summary.byStatus).filter(([key]) => key !== "activo");
  if (inactive.length > 0) text += ` (${inactive.map(([key, n]) => `${key} ${n}`).join(", ")})`;
  if (dicose) text += `; DICOSE ${escape(dicose)}`;
  text += "\n";
  if (summary.active > 0) {
    // category is free text in the table (RLS lets editors write it directly): escape it.
    text += `- activas por categoría: ${parts(summary.byCategory, (key) => escape(categoryLabel(key).toLowerCase()))}\n`;
    text += `- activas por sexo: ${parts(summary.bySex, (key) => sexLabel(key).toLowerCase())}\n`;
    text += `- sin lote: ${summary.withoutLote}; sin lote ni potrero: ${summary.unassigned}\n`;
  }
  const mismatched = reconcileLotes(lotes, summary.byCattle).filter((row) => row.tagged > 0 && row.state !== "ok").slice(0, 10);
  for (const row of mismatched) {
    text += `- cattle_id="${row.id}" ${escape(row.label)}: ${row.count} cabezas, ${row.tagged} caravanas asignadas\n`;
  }
  return text;
}
