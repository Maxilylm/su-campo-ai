import { isValidDateOnly } from "./date";
import { parseLocalizedNumber } from "./number";
import { isUuid } from "./uuid";

export const FINANCIAL_TYPES = ["ingreso", "egreso"] as const;
export const FINANCIAL_CATEGORIES = [
  "venta_ganado", "venta_cosecha", "compra_insumo", "servicio", "mano_obra",
  "transporte", "veterinario", "maquinaria", "otro",
] as const;
export const FINANCIAL_CURRENCIES = ["USD", "UYU", "ARS"] as const;

export type FinanceImportRow = {
  type: string;
  category: string;
  description: string | null;
  amount: number;
  currency: string;
  date: string | null;
  sectionId: string | null;
  cropId: string | null;
  cattleId: string | null;
  notes: string | null;
};

export interface FinanceImportValidation {
  rows: FinanceImportRow[];
  errors: string[];
}

export interface FinanceImportRelationIds {
  sectionIds: string[];
  cropIds: string[];
  cattleIds: string[];
}

export interface FinanceImportRelationOption {
  id: string;
  label: string;
}

export interface FinanceImportRelationResolution {
  id: string | null;
  error: string | null;
}

/** Resolve a CSV relation by id or by an unambiguous, accent-insensitive label. */
export function resolveFinanceImportRelation(
  value: string,
  options: readonly FinanceImportRelationOption[],
  relationLabel: string,
): FinanceImportRelationResolution {
  const normalizedValue = value.trim();
  if (!normalizedValue) return { id: null, error: null };
  const byId = options.find((option) => option.id === normalizedValue);
  if (byId) return { id: byId.id, error: null };

  const normalized = normalizedValue.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
  const matches = options.filter((option) => option.label.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "") === normalized);
  if (matches.length === 1) return { id: matches[0].id, error: null };
  if (matches.length > 1) return { id: null, error: `«${value}» coincide con varias opciones de ${relationLabel}; usá el ID.` };
  return { id: null, error: `No se encontró ${relationLabel} «${value}».` };
}

/** Collect only the foreign keys present in the incoming batch. */
export function collectFinanceImportRelationIds(rows: readonly FinanceImportRow[]): FinanceImportRelationIds {
  const unique = (values: Array<string | null>) => [...new Set(values.filter((value): value is string => Boolean(value) && isUuid(value)))];
  return {
    sectionIds: unique(rows.map((row) => row.sectionId)),
    cropIds: unique(rows.map((row) => row.cropId)),
    cattleIds: unique(rows.map((row) => row.cattleId)),
  };
}

/** Backward-compatible name for finance import callers. */
export const parseFinanceAmount = parseLocalizedNumber;

function text(value: unknown, maxLength: number): string | null {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

/** Validate and normalize client CSV rows and untrusted API payloads alike. */
export function validateFinanceImportRows(rawRows: unknown[], maxRows = 200): FinanceImportValidation {
  const errors: string[] = [];
  const rows: FinanceImportRow[] = [];
  if (rawRows.length > maxRows) errors.push(`La importación admite hasta ${maxRows} filas por vez.`);

  rawRows.slice(0, maxRows).forEach((raw, index) => {
    const line = index + 2;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      errors.push(`Fila ${line}: formato inválido.`);
      return;
    }
    const data = raw as Record<string, unknown>;
    const type = text(data.type, 20) || "";
    const category = text(data.category, 40) || "";
    const description = text(data.description, 500);
    const amount = parseFinanceAmount(data.amount);
    const currency = text(data.currency, 10) || "USD";
    const date = text(data.date, 10);
    const sectionId = text(data.sectionId, 100);
    const cropId = text(data.cropId, 100);
    const cattleId = text(data.cattleId, 100);
    const notes = text(data.notes, 2000);

    if (!FINANCIAL_TYPES.includes(type as typeof FINANCIAL_TYPES[number])) errors.push(`Fila ${line}: tipo inválido (ingreso o egreso).`);
    if (!FINANCIAL_CATEGORIES.includes(category as typeof FINANCIAL_CATEGORIES[number])) errors.push(`Fila ${line}: categoría inválida.`);
    if (!Number.isFinite(amount) || amount <= 0) errors.push(`Fila ${line}: el importe debe ser mayor que cero.`);
    if (!FINANCIAL_CURRENCIES.includes(currency as typeof FINANCIAL_CURRENCIES[number])) errors.push(`Fila ${line}: moneda inválida.`);
    if (date && !isValidDateOnly(date)) errors.push(`Fila ${line}: fecha inválida; usá AAAA-MM-DD.`);

    rows.push({ type, category, description, amount, currency, date, sectionId, cropId, cattleId, notes });
  });

  return { rows, errors };
}
