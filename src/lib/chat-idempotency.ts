import type { SupabaseClient } from "@supabase/supabase-js";
import { withTimeout, SUPABASE_READ_TIMEOUT_MS } from "./timeout";

type ChatDb = SupabaseClient;
type ChatResponse = Record<string, unknown>;

export function normalizeChatRequestId(value: string | null): string | null {
  if (!value || value.length > 100 || !/^[A-Za-z0-9:_-]{16,100}$/.test(value)) return null;
  return value;
}

export type ChatRequestClaim =
  | { kind: "claimed" }
  | { kind: "replay"; response: ChatResponse }
  | { kind: "in_progress"; status: "processing" | "side_effects_done" }
  | { kind: "failed" }
  | { kind: "disabled" }
  | { kind: "unavailable" };

function isMissingChatRequests(error: { code?: string; message?: string } | null): boolean {
  return error?.code === "PGRST205"
    || error?.code === "42P01"
    || error?.code === "42703"
    || /(?:relation|table).*chat_requests.*(?:does not exist|not found)/i.test(error?.message || "");
}

function isChatResponse(value: unknown): value is ChatResponse {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function readClaim(db: ChatDb, farmId: string, requestId: string): Promise<ChatRequestClaim | null> {
  const result = await withTimeout(
    db.from("chat_requests")
      .select("status, response")
      .eq("farm_id", farmId)
      .eq("request_id", requestId)
      .maybeSingle(),
    SUPABASE_READ_TIMEOUT_MS,
    null,
  );

  if (!result) return { kind: "unavailable" };
  if (result.error) {
    if (isMissingChatRequests(result.error)) return { kind: "disabled" };
    return { kind: "unavailable" };
  }
  if (!result.data) return null;

  if (result.data.status === "completed" && isChatResponse(result.data.response)) {
    return { kind: "replay", response: result.data.response };
  }
  if (result.data.status === "side_effects_done" && isChatResponse(result.data.response)) {
    return { kind: "replay", response: result.data.response };
  }
  if (result.data.status === "processing" || result.data.status === "side_effects_done") {
    return { kind: "in_progress", status: result.data.status };
  }
  if (result.data.status === "failed") return { kind: "failed" };
  return null;
}

export async function claimChatRequest(
  db: ChatDb,
  farmId: string,
  requestId: string,
): Promise<ChatRequestClaim> {
  const existing = await readClaim(db, farmId, requestId);
  if (existing) {
    if (existing.kind === "failed") {
      const retryResult = await withTimeout(
        db.from("chat_requests")
          .update({ status: "processing", response: null, updated_at: new Date().toISOString() })
          .eq("farm_id", farmId)
          .eq("request_id", requestId)
          .eq("status", "failed"),
        SUPABASE_READ_TIMEOUT_MS,
        null,
      );
      if (!retryResult) return { kind: "unavailable" };
      if (retryResult.error && isMissingChatRequests(retryResult.error)) return { kind: "disabled" };
      return retryResult.error ? { kind: "unavailable" } : { kind: "claimed" };
    }
    if (existing.kind !== "in_progress") return existing;

    return existing;
  }

  const insertResult = await withTimeout(
    db.from("chat_requests").insert({ farm_id: farmId, request_id: requestId }),
    SUPABASE_READ_TIMEOUT_MS,
    null,
  );
  if (!insertResult) return { kind: "unavailable" };
  if (!insertResult.error) return { kind: "claimed" };
  if (isMissingChatRequests(insertResult.error)) return { kind: "disabled" };

  // Another request may have claimed the same key between the read and insert.
  if (insertResult.error.code === "23505") {
    return (await readClaim(db, farmId, requestId)) || { kind: "unavailable" };
  }
  return { kind: "unavailable" };
}

export async function markChatRequestFailed(
  db: ChatDb,
  farmId: string,
  requestId: string,
  timeoutMs = SUPABASE_READ_TIMEOUT_MS,
): Promise<void> {
  await withTimeout(
    db.from("chat_requests")
      .update({ status: "failed", updated_at: new Date().toISOString() })
      .eq("farm_id", farmId)
      .eq("request_id", requestId)
      .eq("status", "processing"),
    timeoutMs,
    null,
  );
}

export async function markChatRequestSideEffectsDone(
  db: ChatDb,
  farmId: string,
  requestId: string,
  response: unknown,
  timeoutMs = SUPABASE_READ_TIMEOUT_MS,
): Promise<void> {
  await withTimeout(
    db.from("chat_requests")
      .update({ status: "side_effects_done", response, updated_at: new Date().toISOString() })
      .eq("farm_id", farmId)
      .eq("request_id", requestId),
    timeoutMs,
    null,
  );
}

export async function completeChatRequest(
  db: ChatDb,
  farmId: string,
  requestId: string,
  response: unknown,
  timeoutMs = SUPABASE_READ_TIMEOUT_MS,
): Promise<void> {
  await withTimeout(
    db.from("chat_requests")
      .update({ status: "completed", response, updated_at: new Date().toISOString() })
      .eq("farm_id", farmId)
      .eq("request_id", requestId),
    timeoutMs,
    null,
  );
}
