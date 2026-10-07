// Hacienda import: header aliases, category normalization, table → editable
// drafts, and the same validation the import endpoint applies. Shared by the
// CSV/Excel path, the AI column mapping and the photo reader, so every source
// ends in the same reviewed rows and the same POST /api/cattle/import.
import { CATTLE_CATEGORIES, isValidCattleCategory, normalizedEarTag } from "./cattle";
import { isValidDateOnly } from "./date";
import { cellAt, findColumn, isSummaryRow, numberCell, normalizeHeaderKey, parseImportNumber, plainText, textOrNull, type ImportTable } from "./import-table";

export type CattleCategory = (typeof CATTLE_CATEGORIES)[number];

export const CATTLE_IMPORT_FIELDS = [
  "section", "category", "count", "breed", "weightKg", "earTag", "tagRange", "birthDate",
  "origin", "vaccinationStatus", "reproductiveStatus", "healthStatus", "notes",
] as const;
export type CattleImportField = (typeof CATTLE_IMPORT_FIELDS)[number];

export const CATTLE_HEADER_ALIASES: Record<CattleImportField, string[]> = {
  section: ["section", "seccion", "potrero", "potreros", "potr", "pot", "nropotrero", "potreronro", "lote", "sectionname", "seccionname", "sectionid", "ubicacion"],
  category: ["category", "categoria", "categorias", "tipo", "clase", "cat"],
  count: ["count", "cantidad", "cabezas", "headcount", "cant", "cab", "numerodecabezas", "nrocabezas", "total"],
  breed: ["breed", "raza", "razas"],
  weightKg: ["weightkg", "weight", "peso", "pesokg", "pesoprom", "pesopromedio", "pesopromediokg", "pesopromkg", "kgprom", "kgpromedio"],
  earTag: ["eartag", "caravana", "tag", "identificacion", "nrocaravana", "numerocaravana", "dispositivo", "idcaravana"],
  tagRange: ["tagrange", "rangocaravanas", "rango", "rangodecaravanas"],
  birthDate: ["birthdate", "fechanacimiento", "nacimiento", "fechadenacimiento", "fnac"],
  origin: ["origin", "origen", "procedencia"],
  vaccinationStatus: ["vaccinationstatus", "estadovacuna", "vacunacion"],
  reproductiveStatus: ["reproductivestatus", "estadoreproductivo", "reproduccion"],
  healthStatus: ["healthstatus", "estadosanitario", "salud"],
  notes: ["notes", "notas", "observaciones", "obs", "comentarios"],
};

/** Every alias, for header-row detection. */
export const CATTLE_HEADER_KEYS: ReadonlySet<string> = new Set(Object.values(CATTLE_HEADER_ALIASES).flat());

/** One editable preview row. Text fields stay strings until the payload is built. */
export interface CattleDraft {
  category: string;
  count: string;
  /** Resolved potrero id, or null (no potrero or not found). */
  sectionId: string | null;
  /** Potrero as written in the source; kept to flag unknown names. */
  sectionName: string;
  breed: string;
  weightKg: string;
  earTag: string;
  tagRange: string;
  birthDate: string;
  origin: string;
  vaccinationStatus: string;
  reproductiveStatus: string;
  healthStatus: string;
  notes: string;
}

export function emptyCattleDraft(): CattleDraft {
  return {
    category: "", count: "1", sectionId: null, sectionName: "", breed: "", weightKg: "", earTag: "", tagRange: "",
    birthDate: "", origin: "", vaccinationStatus: "", reproductiveStatus: "", healthStatus: "", notes: "",
  };
}

/**
 * Column indices for each field. `categoryColumns` describes a "wide" sheet
 * (one column per category, e.g. Vacas | Novillos | Terneros by potrero);
 * `categoryValues` maps raw category texts the deterministic rules miss
 * ("Vientres entorados" → vaca).
 */
export interface CattleSheetMapping {
  columns: Partial<Record<CattleImportField, number>>;
  categoryColumns?: Record<number, CattleCategory>;
  categoryValues?: Record<string, CattleCategory>;
}

const CATEGORY_RULES: ReadonlyArray<[RegExp, CattleCategory]> = [
  [/^vaq/, "vaquillona"],
  [/^novill/, "novillo"],
  [/^ternera/, "ternera"],
  [/^terner/, "ternero"],
  [/^(vaca|vientre)/, "vaca"],
  [/^tor(o|it)/, "toro"],
  [/^(caball|equin|padrill|potros?$)/, "caballo"],
  [/^(yegu|potras?$)/, "yegua"],
  [/^(ovej|ovin|lanar|borreg|carner|corder|capon)/, "oveja"],
];

/** Map a written category ("Vacas de cría", "Terneros/as", "Vaq. 1-2 años") to the app's categories. */
export function normalizeCattleCategory(raw: string, overrides?: Record<string, CattleCategory>): CattleCategory | null {
  const text = plainText(raw);
  if (!text) return null;
  if (isValidCattleCategory(text)) return text;
  if (overrides) {
    const exact = overrides[raw.trim()];
    if (exact && isValidCattleCategory(exact)) return exact;
    const key = normalizeHeaderKey(raw);
    for (const [source, category] of Object.entries(overrides)) {
      if (normalizeHeaderKey(source) === key && isValidCattleCategory(category)) return category;
    }
  }
  for (const [pattern, category] of CATEGORY_RULES) if (pattern.test(text)) return category;
  return null;
}

/**
 * Recognize the columns of a hacienda sheet by their names. Returns null when
 * there is neither a category column nor category-named columns: the sheet
 * then needs the AI mapping.
 */
export function detectCattleMapping(headers: string[]): CattleSheetMapping | null {
  const columns: Partial<Record<CattleImportField, number>> = {};
  const used = new Set<number>();
  for (const field of CATTLE_IMPORT_FIELDS) {
    const index = findColumn(headers, CATTLE_HEADER_ALIASES[field]);
    if (index >= 0 && !used.has(index)) { columns[field] = index; used.add(index); }
  }
  if (columns.category !== undefined) return { columns };

  const categoryColumns: Record<number, CattleCategory> = {};
  headers.forEach((header, index) => {
    if (used.has(index)) return;
    const category = normalizeCattleCategory(header);
    if (category) categoryColumns[index] = category;
  });
  if (Object.keys(categoryColumns).length === 0) return null;
  // In a wide sheet a "Total" column is the row sum, not a count of its own.
  delete columns.count;
  return { columns, categoryColumns };
}

/** Head count as written: "12", "1.250" (thousands), "1250,0". */
export function parseHeadCount(value: string): number {
  return parseImportNumber(value);
}

/** Dates written as D/M/AAAA or D-M-AAAA become AAAA-MM-DD; anything else is returned unchanged. */
export function normalizeDateText(value: string): string {
  const text = value.trim();
  const match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
  if (!match) return text;
  const iso = `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  return isValidDateOnly(iso) ? iso : text;
}

export interface DraftBuildResult<T> {
  drafts: T[];
  /** Summary ("Total") and blank rows left out. */
  skipped: number;
}

/** Turn every data row of a table into drafts, following the mapping. */
export function cattleDraftsFromTable(table: ImportTable, mapping: CattleSheetMapping): DraftBuildResult<CattleDraft> {
  const drafts: CattleDraft[] = [];
  let skipped = 0;
  const { columns } = mapping;
  const wide = Object.entries(mapping.categoryColumns ?? {})
    .map(([index, category]) => [Number(index), category] as const)
    .filter(([index]) => Number.isInteger(index) && index >= 0);

  for (const row of table.rows) {
    if (isSummaryRow(row) || row.every((value) => value.trim() === "")) { skipped += 1; continue; }
    const base: CattleDraft = {
      ...emptyCattleDraft(),
      sectionName: cellAt(row, columns.section),
      breed: cellAt(row, columns.breed),
      weightKg: numberCell(cellAt(row, columns.weightKg)),
      earTag: cellAt(row, columns.earTag),
      tagRange: cellAt(row, columns.tagRange),
      birthDate: normalizeDateText(cellAt(row, columns.birthDate)),
      origin: cellAt(row, columns.origin),
      vaccinationStatus: cellAt(row, columns.vaccinationStatus),
      reproductiveStatus: cellAt(row, columns.reproductiveStatus),
      healthStatus: cellAt(row, columns.healthStatus),
      notes: cellAt(row, columns.notes),
    };
    if (wide.length > 0) {
      let produced = 0;
      for (const [index, category] of wide) {
        const raw = numberCell(cellAt(row, index));
        const count = parseHeadCount(raw);
        if (!raw || !Number.isFinite(count) || count <= 0) continue;
        drafts.push({ ...base, category, count: String(count) });
        produced += 1;
      }
      if (produced === 0) skipped += 1;
      continue;
    }
    const rawCategory = cellAt(row, columns.category);
    const rawCount = numberCell(cellAt(row, columns.count));
    if (!rawCategory && !rawCount && !base.earTag) { skipped += 1; continue; }
    const category = normalizeCattleCategory(rawCategory, mapping.categoryValues) ?? rawCategory.toLowerCase();
    const parsedCount = rawCount ? parseHeadCount(rawCount) : 1;
    drafts.push({ ...base, category, count: Number.isFinite(parsedCount) ? String(parsedCount) : rawCount });
  }
  return { drafts, skipped };
}

export interface SectionOption {
  id: string;
  name: string;
}

function sectionKey(value: string): string {
  return normalizeHeaderKey(value).replace(/^(potrero|pot|seccion|lote)/, "");
}

/** Find the potrero by id or by an unambiguous, accent-insensitive name ("Potrero 3" = "3"). */
export function findSection(value: string, sections: readonly SectionOption[]): SectionOption | null {
  const text = value.trim();
  if (!text) return null;
  const byId = sections.find((section) => section.id === text);
  if (byId) return byId;
  const exact = sections.filter((section) => normalizeHeaderKey(section.name) === normalizeHeaderKey(text));
  if (exact.length === 1) return exact[0];
  const key = sectionKey(text);
  if (!key) return null;
  const loose = sections.filter((section) => sectionKey(section.name) === key);
  return loose.length === 1 ? loose[0] : null;
}

/** Attach potrero ids to drafts whose written potrero matches one of the farm's. */
export function resolveDraftSections(drafts: CattleDraft[], sections: readonly SectionOption[]): CattleDraft[] {
  return drafts.map((draft) => {
    if (draft.sectionId && sections.some((section) => section.id === draft.sectionId)) return draft;
    const section = findSection(draft.sectionName, sections);
    return section ? { ...draft, sectionId: section.id, sectionName: section.name } : { ...draft, sectionId: null };
  });
}

export interface DraftValidation {
  /** Problems per draft (same order as the drafts). */
  rowErrors: string[][];
  /** Problems that are not about one row. */
  errors: string[];
  /** True when there is something to import and nothing blocks it. */
  valid: boolean;
}

export const MAX_IMPORT_ROWS = 200;
const MAX_HEAD_COUNT = 100_000;

/** The import endpoint's rules, per row, so the preview can show them next to the cells. */
export function validateCattleDrafts(drafts: CattleDraft[], sections: readonly SectionOption[]): DraftValidation {
  const sectionIds = new Set(sections.map((section) => section.id));
  const seenTags = new Map<string, number>();
  const errors: string[] = [];
  if (drafts.length === 0) errors.push("No hay filas para importar.");
  if (drafts.length > MAX_IMPORT_ROWS) errors.push(`Hay ${drafts.length} filas; el máximo por importación es ${MAX_IMPORT_ROWS}.`);
  const rowErrors = drafts.map((draft, index) => {
    const problems: string[] = [];
    const count = parseHeadCount(draft.count || "1");
    const weight = draft.weightKg.trim() ? parseImportNumber(draft.weightKg) : null;
    if (!draft.category.trim()) problems.push("Falta la categoría.");
    else if (!isValidCattleCategory(draft.category)) problems.push(`Categoría «${draft.category}» no reconocida.`);
    if (!Number.isInteger(count) || count < 1 || count > MAX_HEAD_COUNT) problems.push("La cantidad debe ser un entero positivo.");
    if (weight !== null && (!Number.isFinite(weight) || weight <= 0 || weight > 2000)) problems.push("Peso inválido (kg).");
    if (draft.birthDate.trim() && !isValidDateOnly(draft.birthDate.trim())) problems.push("La fecha de nacimiento debe ser AAAA-MM-DD.");
    if (draft.sectionId && !sectionIds.has(draft.sectionId)) problems.push("Potrero no válido para este campo.");
    if (!draft.sectionId && draft.sectionName.trim()) problems.push(`No encontré el potrero «${draft.sectionName.trim()}»: elegilo o dejalo sin potrero.`);
    const tag = normalizedEarTag(draft.earTag);
    if (tag) {
      const previous = seenTags.get(tag);
      if (previous !== undefined) problems.push(`La caravana «${draft.earTag.trim()}» se repite en la fila ${previous + 1}.`);
      else seenTags.set(tag, index);
    }
    return problems;
  });
  const valid = drafts.length > 0 && drafts.length <= MAX_IMPORT_ROWS && rowErrors.every((problems) => problems.length === 0);
  return { rowErrors, errors, valid };
}

/** Rows in the shape POST /api/cattle/import expects. Call only after validateCattleDrafts passes. */
export function cattleImportPayload(drafts: CattleDraft[]): Record<string, unknown>[] {
  return drafts.map((draft) => ({
    sectionId: draft.sectionId,
    category: draft.category,
    count: parseHeadCount(draft.count || "1"),
    breed: textOrNull(draft.breed),
    weightKg: draft.weightKg.trim() ? parseImportNumber(draft.weightKg) : null,
    earTag: textOrNull(draft.earTag),
    tagRange: textOrNull(draft.tagRange),
    birthDate: textOrNull(draft.birthDate),
    origin: textOrNull(draft.origin),
    vaccinationStatus: textOrNull(draft.vaccinationStatus),
    reproductiveStatus: textOrNull(draft.reproductiveStatus),
    healthStatus: textOrNull(draft.healthStatus),
    notes: textOrNull(draft.notes),
  }));
}

/** Share of non-blank category texts in the first rows that are recognizable categories. */
export function cattleCategoryHitRate(table: ImportTable, mapping: CattleSheetMapping): number {
  if (mapping.categoryColumns && Object.keys(mapping.categoryColumns).length > 0) return 1;
  const index = mapping.columns.category;
  if (index === undefined) return 0;
  const values = table.rows.slice(0, 30).map((row) => cellAt(row, index)).filter((value) => value && !isSummaryRow([value]));
  if (values.length === 0) return 0;
  return values.filter((value) => normalizeCattleCategory(value, mapping.categoryValues)).length / values.length;
}
