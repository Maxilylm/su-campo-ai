// Assistant response shape and the read-only guard applied to it.
import { type AIChangeLink } from "./ai-change-links";
import { normalizeAIOperations, type AIOperation } from "./ai-operation";

export interface AIAction {
  intent: "update" | "query" | "setup" | "help";
  response: string;
  dbOperations?: AIOperation[];
  changeLinks?: AIChangeLink[];
  readOnlyBlocked?: boolean;
  pendingConfirmationToken?: string;
  pendingConfirmationRequestId?: string;
  pendingConfirmationExpiresAt?: number;
  pendingConfirmationProposalRequestId?: string;
  pendingConfirmationLinks?: AIChangeLink[];
  confirmedProposalRequestId?: string;
}

export function normalizeAIAction(value: unknown): AIAction | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { intent?: unknown; response?: unknown; dbOperations?: unknown };
  if (typeof candidate.response !== "string" || !candidate.response.trim()) return null;
  const intent = candidate.intent === "update" || candidate.intent === "query" || candidate.intent === "setup" || candidate.intent === "help"
    ? candidate.intent
    : "help";
  const operations = Array.isArray(candidate.dbOperations)
    ? normalizeAIOperations(candidate.dbOperations)
    : undefined;
  return {
    intent,
    response: candidate.response,
    ...(operations ? { dbOperations: operations } : {}),
  };
}

/** Enforce the permission boundary after model output as a second guard. */
export function enforceAIWriteAccess(action: AIAction, canWrite: boolean): AIAction {
  if (canWrite) return action;
  const requestedWrite = action.intent === "update" || action.intent === "setup" || Boolean(action.dbOperations?.length);
  if (!requestedWrite) return action;
  return {
    intent: "help",
    response: "Puedo analizar el estado del campo, pero tu acceso es de solo lectura y no puedo guardar cambios. Pedile a un propietario o editor que aplique esta acción.",
    dbOperations: [],
    readOnlyBlocked: true,
  };
}
