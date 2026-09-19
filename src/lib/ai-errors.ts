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

export const AI_RATE_LIMITED_CODE = "ai_rate_limited";
export const AI_RATE_LIMITED_MESSAGE = "El asistente está muy solicitado en este momento. Esperá un momento e intentá de nuevo.";

// Thrown instead of returning a normal {intent, response} on a Groq 429, so
// the caller never marks the chat request "completed" with a stale error
// baked in — a retry with the same Idempotency-Key gets a fresh attempt once
// the rate limit clears, instead of replaying this response forever.
export class AIRateLimitedError extends Error {
  readonly code = AI_RATE_LIMITED_CODE;
  readonly retryAfterSec: number;

  constructor(retryAfterSec: number) {
    super(AI_RATE_LIMITED_MESSAGE);
    this.name = "AIRateLimitedError";
    this.retryAfterSec = retryAfterSec;
  }
}

export function isAIRateLimitedError(error: unknown): error is AIRateLimitedError {
  return error instanceof AIRateLimitedError
    || (error instanceof Error && error.name === "AIRateLimitedError")
    || (Boolean(error) && typeof error === "object" && (error as { code?: unknown }).code === AI_RATE_LIMITED_CODE);
}

export function aiRateLimitRetryAfterSec(error: unknown, fallbackSec = 20): number {
  if (error instanceof AIRateLimitedError) return error.retryAfterSec;
  if (error && typeof error === "object" && typeof (error as { retryAfterSec?: unknown }).retryAfterSec === "number") {
    return (error as { retryAfterSec: number }).retryAfterSec;
  }
  return fallbackSec;
}
