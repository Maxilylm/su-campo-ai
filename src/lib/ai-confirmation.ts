import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { env } from "./env";
import { normalizeAIOperations, type AIOperation } from "./ai-operation";

const AI_CONFIRMATION_VERSION = 1;
export const AI_CONFIRMATION_TTL_MS = 10 * 60 * 1_000;

interface AIConfirmationPayload {
  v: number;
  farmId: string;
  requestId: string;
  proposalRequestId?: string;
  expiresAt: number;
  operations: AIOperation[];
}

export interface AIConfirmationDetails {
  token: string;
  requestId: string;
  expiresAt: number;
  proposalRequestId?: string;
}

function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decode(value: string): string | null {
  try {
    return Buffer.from(value, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

function signature(payload: string): string {
  return createHmac("sha256", env.supabaseServiceRoleKey).update(payload).digest("base64url");
}

export function createAIConfirmation(
  farmId: string,
  operations: AIOperation[],
  now = Date.now(),
  proposalRequestId?: string,
): AIConfirmationDetails {
  const payload: AIConfirmationPayload = {
    v: AI_CONFIRMATION_VERSION,
    farmId,
    requestId: randomUUID(),
    ...(proposalRequestId && /^[A-Za-z0-9:_-]{16,100}$/.test(proposalRequestId) ? { proposalRequestId } : {}),
    expiresAt: now + AI_CONFIRMATION_TTL_MS,
    operations: normalizeAIOperations(operations),
  };
  const encodedPayload = encode(JSON.stringify(payload));
  return {
    token: `${encodedPayload}.${signature(encodedPayload)}`,
    requestId: payload.requestId,
    expiresAt: payload.expiresAt,
    ...(payload.proposalRequestId ? { proposalRequestId: payload.proposalRequestId } : {}),
  };
}

/** Verify the server-signed proposal and bind it to the current farm. */
export function verifyAIConfirmation(
  token: string,
  farmId: string,
  now = Date.now(),
): (AIConfirmationPayload & { operations: AIOperation[] }) | null {
  if (!token || token.length > 30_000) return null;
  const [encodedPayload, encodedSignature, extra] = token.split(".");
  if (!encodedPayload || !encodedSignature || extra) return null;

  const expected = signature(encodedPayload);
  const expectedBuffer = Buffer.from(expected, "utf8");
  const actualBuffer = Buffer.from(encodedSignature, "utf8");
  if (expectedBuffer.length !== actualBuffer.length || !timingSafeEqual(expectedBuffer, actualBuffer)) return null;

  const decoded = decode(encodedPayload);
  if (!decoded) return null;
  try {
    const payload = JSON.parse(decoded) as Partial<AIConfirmationPayload>;
    if (payload.v !== AI_CONFIRMATION_VERSION
      || payload.farmId !== farmId
      || typeof payload.requestId !== "string"
      || !/^[0-9a-f-]{36}$/i.test(payload.requestId)
      || typeof payload.expiresAt !== "number"
      || payload.expiresAt <= now
      || !Array.isArray(payload.operations)) {
      return null;
    }
    return {
      v: payload.v,
      farmId: payload.farmId,
      requestId: payload.requestId,
      ...(typeof payload.proposalRequestId === "string" ? { proposalRequestId: payload.proposalRequestId } : {}),
      expiresAt: payload.expiresAt,
      operations: normalizeAIOperations(payload.operations),
    };
  } catch {
    return null;
  }
}
