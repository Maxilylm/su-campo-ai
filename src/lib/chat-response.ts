// Pure mapping from /api/chat responses to chat message records, shared by the
// text and audio flows of the Chat page (and its history loader).

import type { ChatMessageRecord } from "@/lib/chat";
import { parseAIChangeReceipt } from "@/lib/ai-change-links";

export type ChatLink = { label: string; href: string };

type PendingConfirmation = {
  token: string;
  requestId: string;
  expiresAt: number;
  proposalRequestId: string;
  affectedLinks: ChatLink[];
};

/** Keeps only `{ label: string, href: string }` entries; undefined when not an array. */
export function pickChatLinks(value: unknown): ChatLink[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((link: { label?: unknown; href?: unknown }) => typeof link?.label === "string" && typeof link?.href === "string");
}

/** Indexes the server's still-open confirmation proposals by the assistant text they belong to. */
export function indexPendingConfirmations(pendingConfirmations: unknown): Map<string, PendingConfirmation> {
  const pendingByResponse = new Map<string, PendingConfirmation>();
  if (!Array.isArray(pendingConfirmations)) return pendingByResponse;
  for (const pending of pendingConfirmations) {
    if (typeof pending?.responseText !== "string"
      || typeof pending.token !== "string"
      || typeof pending.requestId !== "string"
      || typeof pending.expiresAt !== "number"
      || typeof pending.proposalRequestId !== "string") continue;
    pendingByResponse.set(pending.responseText, {
      token: pending.token,
      requestId: pending.requestId,
      expiresAt: pending.expiresAt,
      proposalRequestId: pending.proposalRequestId,
      affectedLinks: pickChatLinks(pending.affectedLinks) ?? [],
    });
  }
  return pendingByResponse;
}

/** Maps saved transcript rows to messages, re-attaching change receipts and open proposals. */
export function historyToMessages(
  saved: Array<{ role: string; content: string }>,
  pendingConfirmations: unknown,
): ChatMessageRecord[] {
  const pendingByResponse = indexPendingConfirmations(pendingConfirmations);
  return saved.map((m) => {
    const persistedChangeLinks = m.role === "assistant" ? parseAIChangeReceipt(m.content) : [];
    const pending = m.role === "assistant" ? pendingByResponse.get(m.content) : undefined;
    return {
      role: m.role as "user" | "assistant",
      text: m.content,
      ...(persistedChangeLinks.length > 0 ? { changeLinks: persistedChangeLinks } : {}),
      ...(pending
        ? {
          pendingConfirmationToken: pending.token,
          pendingConfirmationRequestId: pending.requestId,
          pendingConfirmationExpiresAt: pending.expiresAt,
          pendingConfirmationProposalRequestId: pending.proposalRequestId,
          ...(pending.affectedLinks.length > 0 ? { pendingConfirmationLinks: pending.affectedLinks } : {}),
        }
        : {}),
    };
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ChatResponseData = Record<string, any>;

export function responseHasPendingConfirmation(data: ChatResponseData): boolean {
  return typeof data.pendingConfirmationToken === "string"
    && typeof data.pendingConfirmationRequestId === "string";
}

/** Builds the assistant message for a successful /api/chat or /api/chat/audio response. */
export function assistantMessageFromResponse(data: ChatResponseData): ChatMessageRecord {
  const operationMigration = typeof data.operationMigration === "string" ? data.operationMigration : undefined;
  const changeLinks = pickChatLinks(data.changeLinks);
  const pendingConfirmationLinks = pickChatLinks(data.pendingConfirmationLinks);
  return {
    role: "assistant",
    text: data.response || data.error || "Sin respuesta",
    ...(operationMigration ? { failed: true, operationMigration } : {}),
    ...(changeLinks?.length ? { changeLinks } : {}),
    ...(pendingConfirmationLinks?.length ? { pendingConfirmationLinks } : {}),
    ...(responseHasPendingConfirmation(data)
      ? {
        pendingConfirmationToken: data.pendingConfirmationToken,
        pendingConfirmationRequestId: data.pendingConfirmationRequestId,
        ...(typeof data.pendingConfirmationExpiresAt === "number" ? { pendingConfirmationExpiresAt: data.pendingConfirmationExpiresAt } : {}),
        ...(typeof data.pendingConfirmationProposalRequestId === "string" ? { pendingConfirmationProposalRequestId: data.pendingConfirmationProposalRequestId } : {}),
      }
      : {}),
  };
}

/** The error text shown for a failed request: server messages pass through, transport errors don't. */
export function chatFailureText(error: unknown): string {
  return error instanceof Error && !/abort|fetch failed|failed to fetch/i.test(error.message)
    ? error.message
    : "No pude conectar con CampoAI. Intentá nuevamente.";
}

/** m:ss for the voice-recording timer. */
export function formatRecordingTime(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, "0")}`;
}
