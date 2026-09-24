export interface Transaction {
  id: string;
  type: "ingreso" | "egreso";
  category: string;
  description: string | null;
  amount: number;
  currency: string;
  date: string;
  section_id: string | null;
  crop_id: string | null;
  cattle_id: string | null;
  inventory_movement_id: string | null;
  notes: string | null;
  sections: { name: string } | null;
  crops: { crop_type: string } | null;
  cattle: { category: string; breed: string | null } | null;
  contextOnly?: boolean;
}

export interface FinanceCattleBatch {
  id: string;
  category: string;
  breed: string | null;
  count: number;
  section_id?: string | null;
}

export interface FinanceCrop {
  id: string;
  crop_type: string;
  planted_hectares: number | null;
  section_id?: string | null;
}

export function isCachedTransaction(value: unknown): value is Transaction {
  if (!value || typeof value !== "object") return false;
  const transaction = value as Partial<Transaction>;
  return typeof transaction.id === "string"
    && (transaction.type === "ingreso" || transaction.type === "egreso")
    && typeof transaction.category === "string"
    && typeof transaction.amount === "number"
    && Number.isFinite(transaction.amount)
    && typeof transaction.currency === "string"
    && typeof transaction.date === "string";
}

export type FinancePeriod = "7d" | "30d" | "90d" | "year";

export const FINANCE_PERIODS: { value: FinancePeriod; label: string }[] = [
  { value: "7d", label: "7 días" },
  { value: "30d", label: "30 días" },
  { value: "90d", label: "90 días" },
  { value: "year", label: "Año" },
];

export const FINANCE_CATEGORIES = [
  { value: "venta_ganado", label: "Venta de ganado" },
  { value: "venta_cosecha", label: "Venta de cosecha" },
  { value: "compra_insumo", label: "Compra de insumos" },
  { value: "servicio", label: "Servicio" },
  { value: "mano_obra", label: "Mano de obra" },
  { value: "transporte", label: "Transporte" },
  { value: "veterinario", label: "Veterinario" },
  { value: "maquinaria", label: "Maquinaria" },
  { value: "otro", label: "Otro" },
];

export function financeCategoryLabel(category: string): string {
  return FINANCE_CATEGORIES.find((option) => option.value === category)?.label || category;
}

export const FINANCE_CURRENCIES = ["USD", "UYU", "ARS"];

/** The transaction sheet's fields — also its unsaved-changes signature. */
export interface FinanceFormState {
  editingId: string | null;
  type: "ingreso" | "egreso";
  category: string;
  description: string;
  amount: string;
  currency: string;
  date: string;
  sectionId: string;
  cropId: string;
  cattleId: string;
  notes: string;
}

export function emptyFinanceForm(date: string): FinanceFormState {
  return { editingId: null, type: "egreso", category: "otro", description: "", amount: "", currency: "USD", date, sectionId: "", cropId: "", cattleId: "", notes: "" };
}

export function financeFormSignature(form: FinanceFormState): string {
  return JSON.stringify(form);
}
