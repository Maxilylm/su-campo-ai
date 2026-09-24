import type { LucideIcon } from "lucide-react";
import { Baby, Bandage, Egg, Pill, Scissors, Skull, Stethoscope, Syringe, Thermometer } from "lucide-react";

export interface Vaccination {
  id: string;
  vaccine_name: string;
  date_applied: string;
  next_due: string | null;
  head_count: number;
  applied_by: string | null;
  batch_number: string | null;
  section_id: string | null;
  cattle_id?: string | null;
  notes: string | null;
  cattle?: { category: string; breed: string | null; count: number } | null;
  sections?: { name: string } | null;
}

export interface HealthEvent {
  id: string;
  type: string;
  description: string;
  date_occurred: string;
  head_count: number;
  resolved: boolean;
  veterinarian: string | null;
  section_id: string | null;
  notes: string | null;
  cattle_id: string | null;
  cattle?: { category: string; breed: string | null; count: number } | null;
  sections?: { name: string } | null;
}

export interface CattleOption {
  id: string;
  category: string;
  breed: string | null;
  count: number;
  section_id: string | null;
  sections?: { name: string } | null;
}

export const VACCINES = ["Aftosa", "Brucelosis", "Carbunclo", "Clostridiosis", "Rabia", "Leptospirosis", "IBR", "DVB", "Antiparasitario", "Otra"];

export const HEALTH_TYPES = [
  { value: "nacimiento", label: "Nacimiento" },
  { value: "muerte", label: "Muerte" },
  { value: "enfermedad", label: "Enfermedad" },
  { value: "lesion", label: "Lesión" },
  { value: "tratamiento", label: "Tratamiento" },
  { value: "revision", label: "Revisión" },
  { value: "desparasitacion", label: "Desparasitación" },
  { value: "destete", label: "Destete" },
  { value: "castrado", label: "Castrado" },
];

export const HEALTH_ICON: Record<string, LucideIcon> = {
  nacimiento: Egg,
  muerte: Skull,
  enfermedad: Thermometer,
  lesion: Bandage,
  tratamiento: Pill,
  revision: Stethoscope,
  desparasitacion: Syringe,
  destete: Baby,
  castrado: Scissors,
};

export const STATUS_OPTIONS = [
  { value: "pending", label: "Pendiente" },
  { value: "resolved", label: "Resuelto" },
];

export function lotLabel(cattle: CattleOption): string {
  return `${cattle.category} · ${cattle.count} cab.${cattle.breed ? ` · ${cattle.breed}` : ""}${cattle.sections?.name ? ` · ${cattle.sections.name}` : ""}`;
}

/** "Norte · lote vaca (40 cab.)" — where the record applies, in plain text. */
export function recordScope(record: { sections?: { name: string } | null; cattle?: { category: string; count: number } | null }): string | null {
  const parts = [
    record.sections?.name,
    record.cattle ? `lote ${record.cattle.category} (${record.cattle.count} cab.)` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}
