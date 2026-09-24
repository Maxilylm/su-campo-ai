// Sanidad (vaccinations + health events) form values, the dirty-check
// signature for the unsaved-changes guard, and the section/lot linking rule.
// Pure — see sanidad-form.test.ts.

export type SanidadSheetMode = "add-vax" | "add-health";

export interface VaccinationFormValues {
  name: string;
  section: string;
  cattle: string;
  count: string;
  date: string;
  nextDue: string;
  appliedBy: string;
  batch: string;
  notes: string;
}

export interface HealthFormValues {
  type: string;
  description: string;
  section: string;
  cattle: string;
  count: string;
  date: string;
  veterinarian: string;
  notes: string;
}

export function emptyVaccinationForm(date = ""): VaccinationFormValues {
  return { name: "Aftosa", section: "", cattle: "", count: "1", date, nextDue: "", appliedBy: "", batch: "", notes: "" };
}

export function emptyHealthForm(date = ""): HealthFormValues {
  return { type: "revision", description: "", section: "", cattle: "", count: "1", date, veterinarian: "", notes: "" };
}

export interface SanidadFormSnapshot {
  mode: SanidadSheetMode;
  vaccinationId: string | null;
  healthId: string | null;
  vaccination: VaccinationFormValues;
  health: HealthFormValues;
}

/** Only the form that the sheet is showing counts toward "unsaved changes". */
export function sanidadFormSignature(form: SanidadFormSnapshot): string {
  return JSON.stringify(form.mode === "add-vax"
    ? { mode: form.mode, vaccinationId: form.vaccinationId, ...form.vaccination }
    : { mode: form.mode, healthId: form.healthId, ...form.health });
}

export function vaccinationFormFrom(vaccination: {
  vaccine_name: string; section_id: string | null; cattle_id?: string | null; head_count: number;
  date_applied: string; next_due: string | null; applied_by: string | null; batch_number: string | null; notes: string | null;
}): VaccinationFormValues {
  return {
    name: vaccination.vaccine_name,
    section: vaccination.section_id || "",
    cattle: vaccination.cattle_id || "",
    count: String(vaccination.head_count),
    date: vaccination.date_applied ? vaccination.date_applied.slice(0, 10) : "",
    nextDue: vaccination.next_due ? vaccination.next_due.slice(0, 10) : "",
    appliedBy: vaccination.applied_by || "",
    batch: vaccination.batch_number || "",
    notes: vaccination.notes || "",
  };
}

export function healthFormFrom(event: {
  type: string; description: string; section_id: string | null; cattle_id: string | null; head_count: number;
  date_occurred: string; veterinarian: string | null; notes: string | null;
}): HealthFormValues {
  return {
    type: event.type,
    description: event.description,
    section: event.section_id || "",
    cattle: event.cattle_id || "",
    count: String(event.head_count),
    date: event.date_occurred ? event.date_occurred.slice(0, 10) : "",
    veterinarian: event.veterinarian || "",
    notes: event.notes || "",
  };
}

type Linkable = { section: string; cattle: string };
type LotOption = { id: string; section_id: string | null };

/** Picking a section drops a lot that lives in a different section. */
export function withSection<T extends Linkable>(form: T, value: string, lots: LotOption[]): T {
  const section = value === "none" ? "" : value;
  const lot = lots.find((option) => option.id === form.cattle);
  const keepLot = !(section && lot?.section_id && lot.section_id !== section);
  return { ...form, section, cattle: keepLot ? form.cattle : "" };
}

/** Picking a lot moves the section to the lot's own section, when it has one. */
export function withLot<T extends Linkable>(form: T, value: string, lots: LotOption[]): T {
  const cattle = value === "none" ? "" : value;
  const lot = lots.find((option) => option.id === cattle);
  return { ...form, cattle, section: lot?.section_id ? lot.section_id : form.section };
}
