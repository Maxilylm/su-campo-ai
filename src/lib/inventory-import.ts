// Inventory import: header aliases, value normalization (category, unit,
// currency), table → editable drafts and the endpoint's validation rules.
// Same role as cattle-import.ts for POST /api/inventory/import.
import { cellAt, findColumn, numberCell, isSummaryRow, normalizeHeaderKey, parseImportNumber, plainText, textOrNull, type ImportTable } from "./import-table";
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

export function inventoryDraftsFromTable(table: ImportTable, mapping: InventorySheetMapping): DraftBuildResult<InventoryDraft> {
  const drafts: InventoryDraft[] = [];
  let skipped = 0;
  const { columns } = mapping;
  for (const row of table.rows) {
    const name = cellAt(row, columns.name);
    if (!name || isSummaryRow(row)) { skipped += 1; continue; }
    const rawCategory = cellAt(row, columns.category);
    const rawUnit = cellAt(row, columns.unit);
    const rawCurrency = cellAt(row, columns.currency);
    const stock = cellAt(row, columns.currentStock);
    drafts.push({
      name,
      category: rawCategory ? normalizeInventoryCategory(rawCategory, mapping.categoryValues) ?? rawCategory : normalizeInventoryCategory(name) ?? "otro",
      unit: rawUnit ? normalizeInventoryUnit(rawUnit) ?? rawUnit : "unidad",
      currentStock: stock ? numberCell(stock) || "0" : "0",
      minStock: numberCell(cellAt(row, columns.minStock)),
      costPerUnit: numberCell(cellAt(row, columns.costPerUnit)),
      currency: rawCurrency ? normalizeInventoryCurrency(rawCurrency) ?? rawCurrency : "USD",
      notes: cellAt(row, columns.notes),
    });
  }
  return { drafts, skipped };
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
    if (!Number.isFinite(stock) || stock < 0) problems.push("Stock actual inválido.");
    if (min !== null && (!Number.isFinite(min) || min < 0)) problems.push("Stock mínimo inválido.");
    if (cost !== null && (!Number.isFinite(cost) || cost < 0)) problems.push("Costo unitario inválido.");
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
