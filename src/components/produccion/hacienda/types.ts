export interface Cattle {
  id: string; section_id: string | null; category: string; breed: string | null;
  count: number; tag_range: string | null; ear_tag: string | null;
  health_status: string; weight_kg: number | null; vaccination_status: string;
  reproductive_status: string | null; origin: string; notes: string | null;
}

export interface SectionWithCattle {
  id: string; name: string; size_hectares: number | null; capacity: number | null;
  color: string; water_status: string; pasture_status: string; notes: string | null;
  padron_id: string | null;
  padrones?: { id: string; padron_code: string; department_name: string } | null;
  cattle: Cattle[];
}

export type CattleRow = Cattle & { sectionName: string; sectionColor: string };

/** Dot color for lots without a section — neutral, not a data color. */
export const UNASSIGNED_SECTION_COLOR = "var(--muted-foreground)";

export const CATEGORIES = ["vaca", "toro", "novillo", "vaquillona", "ternero", "ternera", "caballo", "yegua", "oveja"];
export const BREEDS = ["Angus", "Hereford", "Braford", "Brangus", "Holando", "Criolla", "Cruza", "Otra"];

/** User-chosen map colors for sections (data colors, rendered via style). */
export const SECTION_COLORS: { value: string; label: string }[] = [
  { value: "#22c55e", label: "Verde" },
  { value: "#3b82f6", label: "Azul" },
  { value: "#f59e0b", label: "Ámbar" },
  { value: "#ef4444", label: "Rojo" },
  { value: "#8b5cf6", label: "Violeta" },
  { value: "#ec4899", label: "Rosa" },
  { value: "#06b6d4", label: "Celeste" },
  { value: "#84cc16", label: "Lima" },
];
