import { isValidCattleCategory } from "./cattle";
import { isValidDateOnly, isValidDateValue } from "./date";

const SECTION_WATER_STATUS = new Set(["bueno", "bajo", "seco", "inundado"]);
const SECTION_PASTURE_STATUS = new Set(["bueno", "sobrepastoreado", "seco", "creciendo"]);
const CATTLE_ORIGINS = new Set(["propio", "comprado", "transferido"]);
const VACCINATION_STATUS = new Set(["al_dia", "pendiente", "vencida"]);
const REPRODUCTIVE_STATUS = new Set(["prenada", "lactando", "servicio", "vacia"]);
const HEALTH_TYPES = new Set(["nacimiento", "muerte", "enfermedad", "lesion", "tratamiento", "revision", "desparasitacion", "destete", "castrado"]);
const CROP_STATUSES = new Set(["planted", "growing", "harvested", "failed"]);
const APPLICATION_TYPES = new Set(["fertilizante", "herbicida", "insecticida", "fungicida"]);
const INVENTORY_CATEGORIES = new Set(["alimento", "semilla", "fertilizante", "agroquímico", "medicamento", "combustible", "otro"]);
const INVENTORY_UNITS = new Set(["kg", "L", "dosis", "unidad"]);
const FINANCIAL_TYPES = new Set(["ingreso", "egreso"]);
const FINANCIAL_CATEGORIES = new Set(["venta_ganado", "venta_cosecha", "compra_insumo", "servicio", "mano_obra", "transporte", "veterinario", "maquinaria", "otro"]);
const CURRENCIES = new Set(["USD", "UYU", "ARS"]);

function has(data: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(data, key);
}

function nonEmptyString(data: Record<string, unknown>, key: string, required: boolean): string | null {
  if (!has(data, key)) return required ? `${key} is required` : null;
  if (typeof data[key] !== "string" || !data[key].trim()) return `${key} is invalid`;
  return null;
}

function nonNegativeNumber(data: Record<string, unknown>, key: string, integer = false): string | null {
  if (!has(data, key) || data[key] == null || data[key] === "") return null;
  const value = Number(data[key]);
  if (!Number.isFinite(value) || value < 0 || (integer && !Number.isInteger(value))) return `${key} is invalid`;
  return null;
}

function positiveNumber(data: Record<string, unknown>, key: string, integer = false): string | null {
  if (!has(data, key) || data[key] == null || data[key] === "") return null;
  const value = Number(data[key]);
  if (!Number.isFinite(value) || value <= 0 || (integer && !Number.isInteger(value))) return `${key} is invalid`;
  return null;
}

function dateField(data: Record<string, unknown>, key: string, timestamp: boolean): string | null {
  if (!has(data, key) || data[key] == null || data[key] === "") return null;
  const valid = timestamp ? isValidDateValue(data[key]) : isValidDateOnly(data[key]);
  return valid ? null : `${key} is invalid`;
}

function oneOf(data: Record<string, unknown>, key: string, values: Set<string>): string | null {
  if (!has(data, key) || data[key] == null || data[key] === "") return null;
  return values.has(String(data[key])) ? null : `${key} is invalid`;
}

/** Validate model-produced writes before they reach the service-role client. */
export function validateAIOperation(
  table: string,
  action: string,
  data: Record<string, unknown>,
): string | null {
  if (action === "delete" || action === "move" || table === "activities" || table === "tasks") return null;

  const insert = action === "insert";
  let error: string | null = null;
  switch (table) {
    case "sections":
      error = nonEmptyString(data, "name", insert) || nonNegativeNumber(data, "size_hectares") || nonNegativeNumber(data, "capacity", true)
        || oneOf(data, "water_status", SECTION_WATER_STATUS) || oneOf(data, "pasture_status", SECTION_PASTURE_STATUS);
      break;
    case "cattle":
      error = insert && !isValidCattleCategory(data.category) ? "category is invalid" : null;
      error ||= positiveNumber(data, "count", true) || positiveNumber(data, "weight_kg") || dateField(data, "birth_date", true)
        || oneOf(data, "origin", CATTLE_ORIGINS) || oneOf(data, "vaccination_status", VACCINATION_STATUS) || oneOf(data, "reproductive_status", REPRODUCTIVE_STATUS);
      break;
    case "vaccinations":
      error = nonEmptyString(data, "vaccine_name", insert) || positiveNumber(data, "head_count", true)
        || dateField(data, "date_applied", true) || dateField(data, "next_due", true);
      break;
    case "health_events":
      error = nonEmptyString(data, "description", insert) || oneOf(data, "type", HEALTH_TYPES)
        || positiveNumber(data, "head_count", true) || dateField(data, "date_occurred", true);
      break;
    case "crops":
      error = nonEmptyString(data, "crop_type", insert) || nonNegativeNumber(data, "planted_hectares") || nonNegativeNumber(data, "yield_kg")
        || oneOf(data, "status", CROP_STATUSES) || dateField(data, "planting_date", false) || dateField(data, "expected_harvest", false) || dateField(data, "actual_harvest", false);
      break;
    case "crop_applications":
      error = nonEmptyString(data, "crop_id", insert) || oneOf(data, "type", APPLICATION_TYPES) || dateField(data, "date_applied", false);
      break;
    case "inventory_items":
      error = nonEmptyString(data, "name", insert) || oneOf(data, "category", INVENTORY_CATEGORIES) || oneOf(data, "unit", INVENTORY_UNITS)
        || oneOf(data, "currency", CURRENCIES) || nonNegativeNumber(data, "current_stock") || nonNegativeNumber(data, "min_stock") || nonNegativeNumber(data, "cost_per_unit");
      break;
    case "inventory_movements":
      error = nonEmptyString(data, "item_id", insert) || oneOf(data, "type", new Set(["compra", "uso", "ajuste", "pérdida"]))
        || dateField(data, "date", false) || oneOf(data, "currency", CURRENCIES);
      if (!error && has(data, "quantity") && (!Number.isFinite(Number(data.quantity)) || Number(data.quantity) === 0)) error = "quantity is invalid";
      if (!error && has(data, "unit_cost") && data.unit_cost != null && data.unit_cost !== "" && (!Number.isFinite(Number(data.unit_cost)) || Number(data.unit_cost) < 0)) error = "unit_cost is invalid";
      break;
    case "financial_transactions":
      error = oneOf(data, "type", FINANCIAL_TYPES) || oneOf(data, "category", FINANCIAL_CATEGORIES) || oneOf(data, "currency", CURRENCIES)
        || positiveNumber(data, "amount") || dateField(data, "date", false);
      break;
    default:
      break;
  }
  return error;
}

/** Existing-record mutations must target one known row. This prevents an
 * untrusted model response from turning a natural-language request into a
 * farm-wide update or delete filtered by a non-unique field. */
export function validateAIOperationMatch(
  action: string,
  match: Record<string, unknown> | undefined,
): string | null {
  if (action !== "update" && action !== "delete" && action !== "move") return null;
  if (!match || typeof match.id !== "string" || !match.id.trim()) return "match.id is required";
  if (Object.keys(match).some((key) => key !== "id")) return "match must target one id";
  return null;
}
