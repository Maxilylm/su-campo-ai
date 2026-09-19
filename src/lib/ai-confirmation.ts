import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { env } from "./env";
import { normalizeAIOperations, type AIOperation } from "./ai-operation";
import type { AIChangeLink } from "./ai-change-links";

// Bumped to 2 when userId binding was added — an old-format (v1) token now
// fails the version check below instead of being silently treated as
// matching every user. Tokens expire in 10 minutes anyway, so this only
// affects proposals mid-flight exactly at deploy time.
const AI_CONFIRMATION_VERSION = 2;
export const AI_CONFIRMATION_TTL_MS = 10 * 60 * 1_000;

interface AIConfirmationPayload {
  v: number;
  farmId: string;
  // The channel-specific subject who requested the proposal: the
  // authenticated user id for web/audio chat, the sender phone number for
  // WhatsApp. Confirming binds to the same subject that proposed it.
  subjectId: string;
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

export interface PendingAIConfirmationSnapshot {
  responseText: string;
  token: string;
  requestId: string;
  expiresAt: number;
  proposalRequestId: string;
  affectedLinks?: AIChangeLink[];
}

function recordValue(record: unknown, key: string): unknown {
  if (!record || typeof record !== "object" || Array.isArray(record)) return undefined;
  return (record as Record<string, unknown>)[key];
}

function parseAffectedLinks(value: unknown): AIChangeLink[] {
  if (!Array.isArray(value)) return [];
  return value.filter((link): link is AIChangeLink => {
    if (!link || typeof link !== "object" || Array.isArray(link)) return false;
    const candidate = link as Record<string, unknown>;
    return typeof candidate.label === "string"
      && candidate.label.length > 0
      && candidate.label.length <= 60
      && typeof candidate.href === "string"
      && /^\/[A-Za-z0-9/_-]+$/.test(candidate.href);
  }).slice(0, 10);
}

/** Read only the safe, signed proposal metadata persisted by a chat request. */
export function parsePendingAIConfirmation(
  response: unknown,
  now = Date.now(),
): PendingAIConfirmationSnapshot | null {
  const responseText = recordValue(response, "response");
  const token = recordValue(response, "pendingConfirmationToken");
  const requestId = recordValue(response, "pendingConfirmationRequestId");
  const expiresAt = recordValue(response, "pendingConfirmationExpiresAt");
  const proposalRequestId = recordValue(response, "pendingConfirmationProposalRequestId");
  if (typeof responseText !== "string"
    || typeof token !== "string"
    || typeof requestId !== "string"
    || typeof expiresAt !== "number"
    || expiresAt <= now
    || typeof proposalRequestId !== "string") return null;
  const affectedLinks = parseAffectedLinks(recordValue(response, "pendingConfirmationLinks"));
  return {
    responseText,
    token,
    requestId,
    expiresAt,
    proposalRequestId,
    ...(affectedLinks.length > 0 ? { affectedLinks } : {}),
  };
}

export function confirmedAIProposalRequestId(response: unknown): string | null {
  const value = recordValue(response, "confirmedProposalRequestId");
  return typeof value === "string" ? value : null;
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
  return createHmac("sha256", env.aiConfirmationSecret || env.supabaseServiceRoleKey).update(payload).digest("base64url");
}

export function createAIConfirmation(
  farmId: string,
  subjectId: string,
  operations: AIOperation[],
  now = Date.now(),
  proposalRequestId?: string,
): AIConfirmationDetails {
  const payload: AIConfirmationPayload = {
    v: AI_CONFIRMATION_VERSION,
    farmId,
    subjectId,
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

/** Verify the server-signed proposal, bind it to the current farm, and
 * require the confirming subject (userId for web/audio, sender phone for
 * WhatsApp) to match whoever the proposal was created for. */
export function verifyAIConfirmation(
  token: string,
  farmId: string,
  subjectId: string,
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
      || payload.subjectId !== subjectId
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
      subjectId: payload.subjectId,
      requestId: payload.requestId,
      ...(typeof payload.proposalRequestId === "string" ? { proposalRequestId: payload.proposalRequestId } : {}),
      expiresAt: payload.expiresAt,
      operations: normalizeAIOperations(payload.operations),
    };
  } catch {
    return null;
  }
}
