export const AI_CONTEXT_UNAVAILABLE_CODE = "ai_context_unavailable";
export const AI_CONTEXT_UNAVAILABLE_MESSAGE = "No se pudo consultar el estado del campo porque Supabase no está disponible. Revisá Salud de los servicios e intentá nuevamente.";

export class AIFarmContextUnavailableError extends Error {
  readonly code = AI_CONTEXT_UNAVAILABLE_CODE;

  constructor() {
    super(AI_CONTEXT_UNAVAILABLE_MESSAGE);
    this.name = "AIFarmContextUnavailableError";
  }
}

export function isAIFarmContextUnavailableError(error: unknown): boolean {
  return error instanceof AIFarmContextUnavailableError
    || (error instanceof Error && error.name === "AIFarmContextUnavailableError")
    || (Boolean(error) && typeof error === "object" && (error as { code?: unknown }).code === AI_CONTEXT_UNAVAILABLE_CODE);
}
