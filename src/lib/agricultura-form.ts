// Agricultura (crops + crop applications) form values and the dirty-check
// signature for the unsaved-changes guard. Pure — see agricultura-form.test.ts.

export type AgricultureSheetMode = "add-crop" | "edit-crop" | "add-app";

export interface CropFormValues {
  section: string;
  type: string;
  variety: string;
  hectares: string;
  plantingDate: string;
  expectedHarvest: string;
  actualHarvest: string;
  yieldKg: string;
  status: string;
  soilType: string;
  irrigationType: string;
  notes: string;
}

export interface ApplicationFormValues {
  type: string;
  product: string;
  dose: string;
  total: string;
  date: string;
  appliedBy: string;
  weather: string;
  notes: string;
}

export const EMPTY_CROP_FORM: CropFormValues = {
  section: "", type: "soja", variety: "", hectares: "", plantingDate: "", expectedHarvest: "", actualHarvest: "",
  yieldKg: "", status: "planted", soilType: "", irrigationType: "", notes: "",
};

export const EMPTY_APPLICATION_FORM: ApplicationFormValues = {
  type: "fertilizante", product: "", dose: "", total: "", date: "", appliedBy: "", weather: "", notes: "",
};

export interface AgricultureFormSnapshot {
  mode: AgricultureSheetMode;
  editId: string | null;
  appCropId: string | null;
  crop: CropFormValues;
  application: ApplicationFormValues;
}

/** Only the form that the sheet is showing counts toward "unsaved changes". */
export function agricultureFormSignature(form: AgricultureFormSnapshot): string {
  return JSON.stringify(form.mode === "add-app"
    ? { mode: form.mode, appCropId: form.appCropId, ...form.application }
    : { mode: form.mode, editId: form.editId, ...form.crop });
}

export function cropFormFrom(crop: {
  section_id: string | null; crop_type: string; variety: string | null; planted_hectares: number | null;
  planting_date: string | null; expected_harvest: string | null; actual_harvest: string | null; yield_kg: number | null;
  status: string; soil_type: string | null; irrigation_type: string | null; notes: string | null;
}): CropFormValues {
  return {
    section: crop.section_id || "",
    type: crop.crop_type,
    variety: crop.variety || "",
    hectares: crop.planted_hectares?.toString() || "",
    plantingDate: crop.planting_date || "",
    expectedHarvest: crop.expected_harvest || "",
    actualHarvest: crop.actual_harvest || "",
    yieldKg: crop.yield_kg?.toString() || "",
    status: crop.status,
    soilType: crop.soil_type || "",
    irrigationType: crop.irrigation_type || "",
    notes: crop.notes || "",
  };
}

/** Crop status → badge tone. Only failure and a live crop carry color. */
export function cropStatusTone(status: string): "ok" | "bad" | "info" | "muted" {
  if (status === "growing") return "ok";
  if (status === "failed") return "bad";
  if (status === "harvested") return "info";
  return "muted";
}
