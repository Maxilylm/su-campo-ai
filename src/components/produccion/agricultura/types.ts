export interface CropApplication {
  id: string;
  type: string;
  product_name: string | null;
  dose_per_hectare: string | null;
  total_applied: string | null;
  date_applied: string | null;
  applied_by: string | null;
  weather_conditions: string | null;
  notes: string | null;
}

export interface Crop {
  id: string;
  section_id: string | null;
  crop_type: string;
  variety: string | null;
  planted_hectares: number | null;
  planting_date: string | null;
  expected_harvest: string | null;
  actual_harvest: string | null;
  yield_kg: number | null;
  yield_per_hectare: number | null;
  status: string;
  soil_type: string | null;
  irrigation_type: string | null;
  notes: string | null;
  sections?: { name: string } | null;
  crop_applications?: CropApplication[];
}

export const CROP_TYPES = ["soja", "trigo", "maiz", "girasol", "sorgo", "cebada", "arroz", "avena", "otro"];
export const SOIL_TYPES = ["arcilloso", "arenoso", "limoso", "franco"];
export const IRRIGATION_TYPES = ["secano", "pivot", "aspersion", "goteo"];
export const APP_TYPES = ["fertilizante", "herbicida", "insecticida", "fungicida"];
export const WEATHER_OPTIONS = ["soleado", "nublado", "lluvioso", "ventoso"];

/** Display labels for stored values that lack their accent. */
const DISPLAY: Record<string, string> = { maiz: "maíz", aspersion: "aspersión" };

export function optionLabel(value: string): string {
  const label = DISPLAY[value] || value;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export const STATUS_LABELS: Record<string, string> = {
  planted: "Sembrado",
  growing: "Creciendo",
  harvested: "Cosechado",
  failed: "Fallido",
};
