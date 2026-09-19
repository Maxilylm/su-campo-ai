export interface AIOperation {
  table: string;
  action: string;
  data: Record<string, unknown>;
  match?: Record<string, unknown>;
  move_count?: number;
  // Optimistic-concurrency anchor: the target row's updated_at as read when
  // the proposal was created. Only ever set server-side (requireAIConfirmation
  // snapshots it from the DB before signing the confirmation token), never
  // supplied by the model -- present here so it round-trips through the
  // signed token's normalizeAIOperations call on both create and verify.
  expectedUpdatedAt?: string;
}

const INVALID_OPERATION = "__invalid_ai_operation__";
const MAX_AI_OPERATIONS = 20;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Keep model output executable only as data, never as an arbitrary object. */
export function normalizeAIOperations(value: unknown): AIOperation[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_AI_OPERATIONS).map((candidate): AIOperation => {
    if (!isRecord(candidate)) {
      return { table: INVALID_OPERATION, action: INVALID_OPERATION, data: {} };
    }

    const table = typeof candidate.table === "string" ? candidate.table : INVALID_OPERATION;
    const action = typeof candidate.action === "string" ? candidate.action : INVALID_OPERATION;
    if (!isRecord(candidate.data)) {
      return { table: INVALID_OPERATION, action: INVALID_OPERATION, data: {} };
    }

    const operation: AIOperation = { table, action, data: { ...candidate.data } };
    if (candidate.match !== undefined) {
      if (!isRecord(candidate.match)) {
        return { table: INVALID_OPERATION, action: INVALID_OPERATION, data: {} };
      }
      operation.match = { ...candidate.match };
    }
    if (candidate.move_count !== undefined) {
      const moveCount = Number(candidate.move_count);
      if (!Number.isInteger(moveCount) || moveCount <= 0) {
        return { table: INVALID_OPERATION, action: INVALID_OPERATION, data: {} };
      }
      operation.move_count = moveCount;
    }
    if (candidate.expectedUpdatedAt !== undefined) {
      if (typeof candidate.expectedUpdatedAt !== "string" || !candidate.expectedUpdatedAt) {
        return { table: INVALID_OPERATION, action: INVALID_OPERATION, data: {} };
      }
      operation.expectedUpdatedAt = candidate.expectedUpdatedAt;
    }
    return operation;
  });
}

export function isInvalidAIOperation(operation: Pick<AIOperation, "table">): boolean {
  return operation.table === INVALID_OPERATION;
}
