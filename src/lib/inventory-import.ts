// Inventory import: header aliases, value normalization (category, unit,
// currency), table → editable drafts and the endpoint's validation rules.
// Same role as cattle-import.ts for POST /api/inventory/import.
import {
  cellAt, columnDecimalStyle, findColumn, isSummaryRow, normalizeHeaderKey, numberProblem, parseImportNumber, plainText,
  resolveAmbiguousNumber, splitNumberCell, textOrNull, type DecimalStyle, type ImportTable,
} from "./import-table";
import { MAX_IMPORT_ROWS, type DraftBuildResult, type DraftValidation } from "./cattle-import";

export const INVENTORY_CATEGORIES = ["alimento", "semilla", "fertilizante", "agroquímico", "medicamento", "combustible", "otro"] as const;
export const INVENTORY_UNITS = ["kg", "L", "dosis", "unidad"] as const;
export const INVENTORY_CURRENCIES = ["USD", "UYU", "ARS"] as const;
export type InventoryCategory = (typeof INVENTORY_CATEGORIES)[number];
export type InventoryUnit = (typeof INVENTORY_UNITS)[number];
export type InventoryCurrency = (typeof INVENTORY_CURRENCIES)[number];

export const INVENTORY_IMPORT_FIELDS = ["name", "category", "unit", "currentStock", "minStock", "costPerUnit", "currency", "notes"] as const;
export type InventoryImportField = (typeof INVENTORY_IMPORT_FIELDS)[number];

export const INVENTORY_HEADER_ALIASES: Record<InventoryImportField, string[]> = {
  name: ["name", "nombre", "item", "insumo", "producto", "articulo", "descripcion", "detalle", "insumos", "productos"],
  category: ["category", "categoria", "tipo", "rubro"],
  unit: ["unit", "unidad", "um", "unidaddemedida", "medida", "unid"],
  currentStock: ["currentstock", "stockactual", "stock", "cantidad", "existencia", "existencias", "saldo", "cant"],
  minStock: ["minstock", "stockminimo", "minimo", "stockmin"],
  costPerUnit: ["costperunit", "costounitario", "costo", "precio", "preciounitario", "valorunitario", "costounit", "preciounit"],
  currency: ["currency", "moneda", "mon"],
  notes: ["notes", "notas", "observaciones", "obs", "comentarios"],
};

export const INVENTORY_HEADER_KEYS: ReadonlySet<string> = new Set(Object.values(INVENTORY_HEADER_ALIASES).flat());

export interface InventoryDraft {
  name: string;
  category: string;
  unit: string;
  currentStock: string;
  minStock: string;
  costPerUnit: string;
  currency: string;
  notes: string;
}

export function emptyInventoryDraft(): InventoryDraft {
  return { name: "", category: "otro", unit: "unidad", currentStock: "0", minStock: "", costPerUnit: "", currency: "USD", notes: "" };
}

export interface InventorySheetMapping {
  columns: Partial<Record<InventoryImportField, number>>;
  categoryValues?: Record<string, InventoryCategory>;
}

const CATEGORY_RULES: ReadonlyArray<[RegExp, InventoryCategory]> = [
  [/^(alimento|racion|fardo|forraje|suplemento|silo|grano|afrechillo|expeller|sal\b|sales|balanceado|heno|pellet)/, "alimento"],
  [/^semilla/, "semilla"],
  [/^(fertilizante|urea|fosfato|abono|npk|superfosfato)/, "fertilizante"],
  [/^(agroquimico|herbicida|insecticida|fungicida|glifosato|fitosanitario|plaguicida)/, "agroquímico"],
  [/^(medicamento|vacuna|antiparasitario|antibiotico|sanidad|veterinari|ivermectina|remedio)/, "medicamento"],
  [/^(combustible|gasoil|gas oil|diesel|nafta|gasolina|lubricante|aceite motor)/, "combustible"],
  [/^(otro|varios)/, "otro"],
];

export function normalizeInventoryCategory(raw: string, overrides?: Record<string, InventoryCategory>): InventoryCategory | null {
  const text = plainText(raw);
  if (!text) return null;
  if (text === "agroquimico" || text === "agroquimicos") return "agroquímico";
  if ((INVENTORY_CATEGORIES as readonly string[]).includes(text)) return text as InventoryCategory;
  if (overrides) {
    const key = normalizeHeaderKey(raw);
    for (const [source, category] of Object.entries(overrides)) {
      if (normalizeHeaderKey(source) === key && (INVENTORY_CATEGORIES as readonly string[]).includes(category)) return category;
    }
  }
  for (const [pattern, category] of CATEGORY_RULES) if (pattern.test(text)) return category;
  return null;
}

export function normalizeInventoryUnit(raw: string): InventoryUnit | null {
  const text = plainText(raw).replace(/\.$/, "");
  if (!text) return null;
  if (/^(kg|kgs|kilo|kilos|kilogramo|kilogramos|k)$/.test(text)) return "kg";
  if (/^(l|lt|lts|litro|litros|ltr)$/.test(text)) return "L";
  if (/^(dosis|ds|dos)$/.test(text)) return "dosis";
  if (/^(unidad|unidades|u|un|unid|uds|ud|bolsa|bolsas|fardo|fardos|caja|cajas|bidon|bidones)$/.test(text)) return "unidad";
  return null;
}

export function normalizeInventoryCurrency(raw: string): InventoryCurrency | null {
  const text = plainText(raw).replace(/\s/g, "");
  if (!text) return null;
  if (/^(usd|us\$|u\$s|u\$d|dolar|dolares|us|u\$)$/.test(text)) return "USD";
  if (/^(uyu|\$|\$u|pesos|pesosuruguayos|\$uy)$/.test(text)) return "UYU";
  if (/^(ars|pesosargentinos|\$ar)$/.test(text)) return "ARS";
  return null;
}

/** Recognize inventory columns by name; null when there is no item-name column. */
export function detectInventoryMapping(headers: string[]): InventorySheetMapping | null {
  const columns: Partial<Record<InventoryImportField, number>> = {};
  const used = new Set<number>();
  for (const field of INVENTORY_IMPORT_FIELDS) {
    const index = findColumn(headers, INVENTORY_HEADER_ALIASES[field]);
    if (index >= 0 && !used.has(index)) { columns[field] = index; used.add(index); }
  }
  return columns.name === undefined ? null : { columns };
}

/**
 * A number cell that may carry a unit or currency ("300 kg", "$U 350").
 * The token is kept when it is recognized and does not contradict
 * `expected` (the unit/currency column); any other extra text returns the
 * whole cell so the preview flags it instead of dropping "bolsas de 25 kg".
 */
function numberWithToken<T extends string>(raw: string, tokenOf: (rest: string) => T | null, expected: T | null, style: DecimalStyle): { text: string; token: T | null } {
  const { number, rest } = splitNumberCell(raw);
  if (!number) return { text: rest, token: null };
  if (!rest) return { text: resolveAmbiguousNumber(number, style), token: null };
  const token = tokenOf(rest);
  if (!token || (expected !== null && expected !== token)) return { text: raw.trim(), token: null };
  return { text: resolveAmbiguousNumber(number, style), token };
}

export interface InventoryRawValues {
  name: string;
  category: string;
  unit: string;
  currentStock: string;
  minStock: string;
  costPerUnit: string;
  currency: string;
  notes: string;
}

export interface InventoryDraftOptions {
  categoryValues?: Record<string, InventoryCategory>;
  styles?: { currentStock: DecimalStyle; minStock: DecimalStyle; costPerUnit: DecimalStyle };
  /** What an empty stock becomes: "0" for a sheet (blank = none), "?" for a photo (unreadable). */
  blankStock?: "0" | "?";
}

/**
 * One inventory draft from raw texts (a sheet row or a photo row). Units
 * and currencies written next to the numbers fill the unit/currency when
 * those are blank. `guessedCurrency` is true when a cost has no currency
 * anywhere and USD was assumed.
 */
export function inventoryDraftFromValues(raw: InventoryRawValues, options: InventoryDraftOptions = {}): { draft: InventoryDraft; guessedCurrency: boolean } {
  const styles = options.styles ?? { currentStock: "unknown", minStock: "unknown", costPerUnit: "unknown" };
  const unitColumn = raw.unit.trim() ? normalizeInventoryUnit(raw.unit) : null;
  const currencyColumn = raw.currency.trim() ? normalizeInventoryCurrency(raw.currency) : null;
  const stock = numberWithToken(raw.currentStock, normalizeInventoryUnit, unitColumn, styles.currentStock);
  const min = numberWithToken(raw.minStock, normalizeInventoryUnit, unitColumn ?? stock.token, styles.minStock);
  const cost = numberWithToken(raw.costPerUnit, normalizeInventoryCurrency, currencyColumn, styles.costPerUnit);
  const unit = raw.unit.trim() ? unitColumn ?? raw.unit.trim() : stock.token ?? min.token ?? "unidad";
  const currency = raw.currency.trim() ? currencyColumn ?? raw.currency.trim() : cost.token ?? "USD";
  const rawCategory = raw.category.trim();
  return {
    draft: {
      name: raw.name.trim(),
      category: rawCategory ? normalizeInventoryCategory(rawCategory, options.categoryValues) ?? rawCategory : normalizeInventoryCategory(raw.name) ?? "otro",
      unit,
      currentStock: stock.text || (options.blankStock ?? "0"),
      minStock: min.text,
      costPerUnit: cost.text,
      currency,
      notes: raw.notes.trim(),
    },
    guessedCurrency: Boolean(cost.text) && !raw.currency.trim() && !cost.token,
  };
}

export function guessedCurrencyWarning(count: number): string {
  return `En ${count} ${count === 1 ? "fila" : "filas"} no figura la moneda del costo: se asumió USD. Revisalo antes de importar.`;
}

export function inventoryDraftsFromTable(table: ImportTable, mapping: InventorySheetMapping): DraftBuildResult<InventoryDraft> {
  const drafts: InventoryDraft[] = [];
  let skipped = 0;
  let guessed = 0;
  const { columns } = mapping;
  const numbersOf = (index: number | undefined) => table.rows.map((row) => splitNumberCell(cellAt(row, index)).number);
  const styles = {
    currentStock: columnDecimalStyle(table, numbersOf(columns.currentStock)),
    minStock: columnDecimalStyle(table, numbersOf(columns.minStock)),
    costPerUnit: columnDecimalStyle(table, numbersOf(columns.costPerUnit)),
  };
  for (const row of table.rows) {
    const name = cellAt(row, columns.name);
    if (!name || isSummaryRow(row)) { skipped += 1; continue; }
    const { draft, guessedCurrency } = inventoryDraftFromValues({
      name,
      category: cellAt(row, columns.category),
      unit: cellAt(row, columns.unit),
      currentStock: cellAt(row, columns.currentStock),
      minStock: cellAt(row, columns.minStock),
      costPerUnit: cellAt(row, columns.costPerUnit),
      currency: cellAt(row, columns.currency),
      notes: cellAt(row, columns.notes),
    }, { categoryValues: mapping.categoryValues, styles });
    if (guessedCurrency) guessed += 1;
    drafts.push(draft);
  }
  return { drafts, skipped, warnings: guessed > 0 ? [guessedCurrencyWarning(guessed)] : [] };
}

function optionalNumber(value: string): number | null {
  return value.trim() ? parseImportNumber(value) : null;
}

export function validateInventoryDrafts(drafts: InventoryDraft[]): DraftValidation {
  const errors: string[] = [];
  if (drafts.length === 0) errors.push("No hay filas para importar.");
  if (drafts.length > MAX_IMPORT_ROWS) errors.push(`Hay ${drafts.length} filas; el máximo por importación es ${MAX_IMPORT_ROWS}.`);
  const rowErrors = drafts.map((draft) => {
    const problems: string[] = [];
    const stock = optionalNumber(draft.currentStock) ?? 0;
    const min = optionalNumber(draft.minStock);
    const cost = optionalNumber(draft.costPerUnit);
    if (!draft.name.trim()) problems.push("Falta el nombre.");
    if (!(INVENTORY_CATEGORIES as readonly string[]).includes(draft.category)) problems.push(`Categoría «${draft.category}» no reconocida.`);
    if (!(INVENTORY_UNITS as readonly string[]).includes(draft.unit)) problems.push(`Unidad «${draft.unit}» no reconocida.`);
    if (!(INVENTORY_CURRENCIES as readonly string[]).includes(draft.currency)) problems.push(`Moneda «${draft.currency}» no reconocida.`);
    if (!Number.isFinite(stock)) problems.push(numberProblem("Stock actual", draft.currentStock));
    else if (stock < 0) problems.push("Stock actual inválido.");
    if (min !== null && !Number.isFinite(min)) problems.push(numberProblem("Stock mínimo", draft.minStock));
    else if (min !== null && min < 0) problems.push("Stock mínimo inválido.");
    if (cost !== null && !Number.isFinite(cost)) problems.push(numberProblem("Costo unitario", draft.costPerUnit));
    else if (cost !== null && cost < 0) problems.push("Costo unitario inválido.");
    return problems;
  });
  const valid = drafts.length > 0 && drafts.length <= MAX_IMPORT_ROWS && rowErrors.every((problems) => problems.length === 0);
  return { rowErrors, errors, valid };
}

/** Rows in the shape POST /api/inventory/import expects. */
export function inventoryImportPayload(drafts: InventoryDraft[]): Record<string, unknown>[] {
  return drafts.map((draft) => ({
    name: draft.name.trim(),
    category: draft.category,
    unit: draft.unit,
    currentStock: optionalNumber(draft.currentStock) ?? 0,
    minStock: optionalNumber(draft.minStock),
    costPerUnit: optionalNumber(draft.costPerUnit),
    currency: draft.currency,
    notes: textOrNull(draft.notes),
  }));
}
