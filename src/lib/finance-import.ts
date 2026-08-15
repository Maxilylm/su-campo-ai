import { isValidDateOnly } from "./date";

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
    const amount = Number(data.amount);
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
