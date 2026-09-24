import { Drumstick, FlaskConical, Fuel, Package, Pill, Sprout, type LucideIcon } from "lucide-react";

export interface InventoryItem {
  id: string;
  name: string;
  category: string;
  unit: string;
  current_stock: number;
  min_stock: number | null;
  cost_per_unit: number | null;
  currency?: string | null;
  notes: string | null;
}

export interface InventoryCropOption {
  id: string;
  crop_type: string;
  section_id: string | null;
}

export interface InventoryCattleOption {
  id: string;
  category: string;
  breed: string | null;
  count: number;
  section_id: string | null;
}

export interface InventoryMovement {
  id: string;
  item_id: string;
  type: "compra" | "uso" | "ajuste" | "pérdida";
  quantity: number;
  date: string;
  section_id: string | null;
  crop_id: string | null;
  cattle_id: string | null;
  notes: string | null;
  inventory_items: { name: string; unit: string } | null;
  sections: { name: string } | null;
  crops: { crop_type: string } | null;
  cattle: { category: string; breed: string | null; count: number } | null;
}

export const INVENTORY_CATEGORIES: { value: string; label: string; icon: LucideIcon }[] = [
  { value: "alimento", label: "Alimento", icon: Drumstick },
  { value: "semilla", label: "Semilla", icon: Sprout },
  { value: "fertilizante", label: "Fertilizante", icon: FlaskConical },
  { value: "agroquímico", label: "Agroquímico", icon: FlaskConical },
  { value: "medicamento", label: "Medicamento", icon: Pill },
  { value: "combustible", label: "Combustible", icon: Fuel },
  { value: "otro", label: "Otro", icon: Package },
];

export function inventoryCategoryIcon(category: string): LucideIcon {
  return INVENTORY_CATEGORIES.find((option) => option.value === category)?.icon || Package;
}

export const INVENTORY_UNITS = ["kg", "L", "dosis", "unidad"];
export const INVENTORY_CURRENCIES = ["USD", "UYU", "ARS"];

export const MOVEMENT_LABELS: Record<InventoryMovement["type"], string> = {
  compra: "Compra",
  uso: "Uso",
  ajuste: "Ajuste",
  "pérdida": "Pérdida",
};

export interface ItemFormState {
  name: string;
  category: string;
  unit: string;
  currency: string;
  minStock: string;
  notes: string;
}

export interface MovementFormState {
  itemId: string;
  quantity: string;
  unitCost: string;
  currency: string;
  sectionId: string;
  cropId: string;
  cattleId: string;
  date: string;
  notes: string;
}

export const EMPTY_ITEM_FORM: ItemFormState = { name: "", category: "alimento", unit: "kg", currency: "USD", minStock: "", notes: "" };

export function emptyMovementForm(date: string): MovementFormState {
  return { itemId: "", quantity: "", unitCost: "", currency: "USD", sectionId: "", cropId: "", cattleId: "", date, notes: "" };
}
