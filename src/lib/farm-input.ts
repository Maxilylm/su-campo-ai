export const FARM_NAME_MAX_LENGTH = 200;
export const FARM_LOCATION_MAX_LENGTH = 200;

export const FARM_OPERATION_TYPES = ["livestock", "crops", "mixed"] as const;
export type FarmOperationType = (typeof FARM_OPERATION_TYPES)[number];

export interface FarmProfileInput {
  name?: string;
  totalHectares?: number | null;
  location?: string | null;
  operationType?: FarmOperationType;
}

type ValidationResult =
  | { ok: true; value: FarmProfileInput }
  | { ok: false; error: string };

function has(input: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(input, key);
}

/**
 * Validate and normalize the farm profile at the API boundary and in the
 * setup form. Keeping this in one place prevents the browser and server from
 * accepting different values (especially whitespace-only names).
 */
export function validateFarmProfileInput(
  input: Record<string, unknown>,
  mode: "create" | "update",
): ValidationResult {
  const value: FarmProfileInput = {};

  if (mode === "create" || has(input, "name")) {
    if (input.name == null || input.name === "") {
      if (mode === "create") value.name = "Mi Campo";
      else return { ok: false, error: "name inválido" };
    } else if (typeof input.name !== "string" || !input.name.trim() || input.name.trim().length > FARM_NAME_MAX_LENGTH) {
      return { ok: false, error: "name inválido" };
    } else {
      value.name = input.name.trim();
    }
  }

  if (mode === "create" || has(input, "totalHectares")) {
    const rawHectares = input.totalHectares;
    const hectares = rawHectares == null || rawHectares === "" ? null : Number(rawHectares);
    if (hectares !== null && (!Number.isFinite(hectares) || hectares < 0)) {
      return { ok: false, error: "totalHectares inválido" };
    }
    value.totalHectares = hectares;
  }

  if (mode === "create" || has(input, "location")) {
    const rawLocation = input.location;
    if (rawLocation != null && typeof rawLocation !== "string") {
      return { ok: false, error: "location inválida" };
    }
    if (typeof rawLocation === "string" && rawLocation.trim().length > FARM_LOCATION_MAX_LENGTH) {
      return { ok: false, error: "location inválida" };
    }
    value.location = typeof rawLocation === "string" && rawLocation.trim() ? rawLocation.trim() : null;
  }

  if (mode === "create" || has(input, "operationType")) {
    const operationType = input.operationType == null || input.operationType === ""
      ? mode === "create" ? "livestock" : null
      : input.operationType;
    if (operationType === null || !FARM_OPERATION_TYPES.includes(operationType as FarmOperationType)) {
      return { ok: false, error: "operationType inválido" };
    }
    value.operationType = operationType as FarmOperationType;
  }

  return { ok: true, value };
}
