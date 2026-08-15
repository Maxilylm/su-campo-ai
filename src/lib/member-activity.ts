import { getSupabaseAdmin } from "./supabase";
import { withTimeout } from "./timeout";

const MEMBER_ACTIVITY_TIMEOUT_MS = 2000;

export type MemberActivityActor = { id: string; email?: string | null };

/** Activity history must never turn a successful access change into an error. */
export async function recordMemberActivity(
  farmId: string,
  actor: MemberActivityActor,
  description: string,
  metadata: Record<string, string>,
) {
  const result = await withTimeout(
    getSupabaseAdmin().from("activities").insert({
      farm_id: farmId,
      type: "setup",
      description,
      message_type: "text",
      reported_by: actor.email || actor.id,
      metadata: { source: "farm_members", ...metadata },
    }),
    MEMBER_ACTIVITY_TIMEOUT_MS,
    null,
  );
  if (!result || result.error) console.warn("member activity log:", result?.error?.message || "timed out");
}
