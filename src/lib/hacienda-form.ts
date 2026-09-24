// Hacienda (sections + cattle lots) form values and the dirty-check signature
// used by the unsaved-changes guard. Pure — see hacienda-form.test.ts.

export type HaciendaSheetMode = "add-section" | "edit-section" | "add-cattle" | "edit-cattle";

export interface SectionFormValues {
  name: string;
  hectares: string;
  capacity: string;
  color: string;
  water: string;
  pasture: string;
  notes: string;
}

export interface CattleFormValues {
  section: string;
  category: string;
  breed: string;
  count: string;
  weight: string;
  earTag: string;
  origin: string;
  vaccinationStatus: string;
  reproductive: string;
  health: string;
  notes: string;
}

export const DEFAULT_SECTION_COLOR = "#22c55e";

export const EMPTY_SECTION_FORM: SectionFormValues = {
  name: "", hectares: "", capacity: "", color: DEFAULT_SECTION_COLOR, water: "bueno", pasture: "bueno", notes: "",
};

export const EMPTY_CATTLE_FORM: CattleFormValues = {
  section: "", category: "vaca", breed: "", count: "1", weight: "", earTag: "", origin: "propio",
  vaccinationStatus: "pendiente", reproductive: "", health: "healthy", notes: "",
};

export interface HaciendaFormSnapshot {
  mode: HaciendaSheetMode;
  editId: string | null;
  section: SectionFormValues;
  cattle: CattleFormValues;
}

/** Only the form that the sheet is showing counts toward "unsaved changes". */
export function haciendaFormSignature(form: HaciendaFormSnapshot): string {
  return JSON.stringify(form.mode === "add-section" || form.mode === "edit-section"
    ? { mode: form.mode, editId: form.editId, ...form.section }
    : { mode: form.mode, editId: form.editId, ...form.cattle });
}

export function sectionFormFrom(section: {
  name: string; size_hectares: number | null; capacity: number | null; color: string;
  water_status: string; pasture_status: string; notes: string | null;
}): SectionFormValues {
  return {
    name: section.name,
    hectares: section.size_hectares?.toString() || "",
    capacity: section.capacity?.toString() || "",
    color: section.color,
    water: section.water_status,
    pasture: section.pasture_status,
    notes: section.notes || "",
  };
}

export function cattleFormFrom(cattle: {
  section_id: string | null; category: string; breed: string | null; count: number; weight_kg: number | null;
  ear_tag: string | null; origin: string; vaccination_status: string; reproductive_status: string | null;
  health_status: string; notes: string | null;
}): CattleFormValues {
  return {
    section: cattle.section_id || "",
    category: cattle.category,
    breed: cattle.breed || "",
    count: cattle.count.toString(),
    weight: cattle.weight_kg?.toString() || "",
    earTag: cattle.ear_tag || "",
    origin: cattle.origin || "propio",
    vaccinationStatus: cattle.vaccination_status || "pendiente",
    reproductive: cattle.reproductive_status || "",
    health: cattle.health_status || "healthy",
    notes: cattle.notes || "",
  };
}

/** Water/pasture condition → state tone, matching the Hoy potreros list. */
export function waterTone(status: string): "bad" | "warn" | null {
  if (status === "seco" || status === "inundado") return "bad";
  if (status === "bajo") return "warn";
  return null;
}

export function pastureTone(status: string): "warn" | null {
  return status === "sobrepastoreado" || status === "seco" ? "warn" : null;
}
