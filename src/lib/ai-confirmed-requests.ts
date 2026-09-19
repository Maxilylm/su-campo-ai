import type { SupabaseClient } from "@supabase/supabase-js";
import { withTimeout, SUPABASE_READ_TIMEOUT_MS } from "./timeout";

export type ConfirmedProposalClaim = "claimed" | "already_used" | "unavailable";

/** Marks a confirmed AI proposal's requestId as consumed, once and never
 * again -- independent of chat_requests, which "Limpiar historial" deletes
 * (clearing a farm's chat_messages and chat_requests together), silently
 * re-enabling replay of a still-valid signed confirmation token (10-minute
 * TTL) as if it had never been applied. Rows here are pure bookkeeping,
 * purged after a day by the same job that purges whatsapp_events/
 * chat_requests (040/045). */
export async function claimConfirmedProposal(
  db: SupabaseClient,
  farmId: string,
  requestId: string,
): Promise<ConfirmedProposalClaim> {
  const result = await withTimeout(
    db.from("ai_confirmed_requests").insert({ request_id: requestId, farm_id: farmId }),
    SUPABASE_READ_TIMEOUT_MS,
    null,
  );
  if (!result) return "unavailable";
  if (!result.error) return "claimed";
  if (result.error.code === "23505") return "already_used";
  return "unavailable";
}
