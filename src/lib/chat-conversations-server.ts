// Server-side access to chat_conversations (migration 052). Every query is
// scoped by farm_id. Until 052 is applied the table/column is missing: callers
// get { kind: "legacy" } and keep the single shared thread of older releases.
import type { SupabaseClient } from "@supabase/supabase-js";
import { withTimeout, SUPABASE_READ_TIMEOUT_MS } from "./timeout";
import {
  WHATSAPP_CONVERSATION_TITLE,
  conversationTitleFromMessage,
  normalizeConversationId,
  type ChatConversationSummary,
  type ConversationChannel,
} from "./chat-conversations";

type Db = SupabaseClient;
type DbError = { code?: string; message?: string } | null | undefined;

export const CONVERSATION_COLUMNS = "id, title, channel, created_by, created_at, updated_at";

export function isMissingConversationSchema(error: DbError): boolean {
  if (!error) return false;
  if (error.code === "42P01" || error.code === "PGRST205" || error.code === "42703" || error.code === "PGRST204") return true;
  return /(?:chat_conversations|conversation_id)/i.test(error.message || "")
    && /(?:does not exist|not found|could not find|schema cache)/i.test(error.message || "");
}

/** Where a chat turn is read from and written to. */
export type ConversationTarget =
  /** 052 not applied: the farm-wide shared thread, as before. */
  | { kind: "legacy" }
  /** A conversation of this farm. */
  | { kind: "existing"; id: string }
  /** A new conversation, created when the turn is saved. */
  | { kind: "new" }
  | { kind: "not_found" }
  | { kind: "unavailable" };

/**
 * `requested.present` is whether the client sent the conversationId field at
 * all. Current clients always send it (null = start a new conversation). A
 * client from before conversations existed never sends it; its turns continue
 * the farm's most recent web conversation instead of opening one per message.
 */
export async function resolveConversationTarget(
  db: Db,
  farmId: string,
  requested: { present: boolean; id: unknown },
  timeoutMs = SUPABASE_READ_TIMEOUT_MS,
): Promise<ConversationTarget> {
  if (requested.present && requested.id !== null && requested.id !== undefined && requested.id !== "") {
    const id = normalizeConversationId(requested.id);
    if (!id) return { kind: "not_found" };
    const result = await withTimeout(
      db.from("chat_conversations")
        .select("id")
        .eq("id", id)
        .eq("farm_id", farmId)
        .is("archived_at", null)
        .maybeSingle(),
      timeoutMs,
      null,
    );
    if (!result) return { kind: "unavailable" };
    if (result.error) return isMissingConversationSchema(result.error) ? { kind: "legacy" } : { kind: "unavailable" };
    return result.data ? { kind: "existing", id } : { kind: "not_found" };
  }

  let query = db.from("chat_conversations")
    .select("id")
    .eq("farm_id", farmId)
    .is("archived_at", null);
  if (!requested.present) query = query.eq("channel", "web");
  const result = await withTimeout(
    query.order("updated_at", { ascending: false }).limit(1),
    timeoutMs,
    null,
  );
  if (!result) return { kind: "unavailable" };
  if (result.error) return isMissingConversationSchema(result.error) ? { kind: "legacy" } : { kind: "unavailable" };
  if (!requested.present && result.data?.[0]?.id) return { kind: "existing", id: result.data[0].id as string };
  return { kind: "new" };
}

export type CreatedConversation =
  | { kind: "created"; conversation: ChatConversationSummary }
  | { kind: "legacy" }
  | { kind: "error" };

export async function createConversation(
  db: Db,
  input: { farmId: string; userId: string | null; title: string; channel?: ConversationChannel },
  timeoutMs = SUPABASE_READ_TIMEOUT_MS,
): Promise<CreatedConversation> {
  const result = await withTimeout(
    db.from("chat_conversations")
      .insert({
        farm_id: input.farmId,
        created_by: input.userId,
        title: input.title,
        channel: input.channel ?? "web",
      })
      .select(CONVERSATION_COLUMNS)
      .single(),
    timeoutMs,
    null,
  );
  if (!result) return { kind: "error" };
  if (result.error) {
    if (isMissingConversationSchema(result.error)) return { kind: "legacy" };
    console.error("Chat conversation create failed:", result.error.message);
    return { kind: "error" };
  }
  return { kind: "created", conversation: result.data as ChatConversationSummary };
}

/** The farm's single WhatsApp conversation, created on first use. */
export async function ensureWhatsAppConversation(db: Db, farmId: string, timeoutMs: number): Promise<ConversationTarget> {
  const read = async (): Promise<ConversationTarget | null> => {
    const result = await withTimeout(
      db.from("chat_conversations")
        .select("id")
        .eq("farm_id", farmId)
        .eq("channel", "whatsapp")
        .maybeSingle(),
      timeoutMs,
      null,
    );
    if (!result) return { kind: "unavailable" };
    if (result.error) return isMissingConversationSchema(result.error) ? { kind: "legacy" } : { kind: "unavailable" };
    return result.data?.id ? { kind: "existing", id: result.data.id as string } : null;
  };
  try {
    const existing = await read();
    if (existing) return existing;
    const created = await withTimeout(
      db.from("chat_conversations")
        .insert({ farm_id: farmId, title: WHATSAPP_CONVERSATION_TITLE, channel: "whatsapp" })
        .select("id")
        .single(),
      timeoutMs,
      null,
    );
    if (!created) return { kind: "unavailable" };
    if (created.error) {
      if (isMissingConversationSchema(created.error)) return { kind: "legacy" };
      // 23505: a concurrent webhook created it first.
      if (created.error.code === "23505") return (await read()) ?? { kind: "unavailable" };
      return { kind: "unavailable" };
    }
    return { kind: "existing", id: created.data.id as string };
  } catch {
    return { kind: "unavailable" };
  }
}

export type PersistChatTurnResult =
  | { ok: true; conversationId: string | null; conversationTitle?: string }
  | { ok: false; reason: "timeout" | "error"; conversationId: string | null };

/**
 * Saves a user turn and its answer. A "new" target creates the conversation
 * first (titled from the user's message); a "legacy" target writes the rows
 * without conversation_id, like releases before 052.
 */
export async function persistChatTurn(
  db: Db,
  input: {
    farmId: string;
    userId: string;
    authorRole: string;
    target: ConversationTarget;
    userContent: string;
    assistantContent: string;
    timeoutMs: number;
  },
): Promise<PersistChatTurnResult> {
  let conversationId: string | null = input.target.kind === "existing" ? input.target.id : null;
  let conversationTitle: string | undefined;
  if (input.target.kind === "new") {
    const created = await createConversation(db, {
      farmId: input.farmId,
      userId: input.userId,
      title: conversationTitleFromMessage(input.userContent),
    }, input.timeoutMs);
    if (created.kind === "error") return { ok: false, reason: "error", conversationId: null };
    if (created.kind === "created") {
      conversationId = created.conversation.id;
      conversationTitle = created.conversation.title;
    }
  }
  const scope = conversationId ? { conversation_id: conversationId } : {};
  const persistResult = await withTimeout(
    db.from("chat_messages").insert([
      { farm_id: input.farmId, role: "user", content: input.userContent, author_role: input.authorRole, ...scope },
      { farm_id: input.farmId, role: "assistant", content: input.assistantContent, author_role: input.authorRole, ...scope },
    ]),
    input.timeoutMs,
    null,
  );
  if (!persistResult) return { ok: false, reason: "timeout", conversationId };
  if (persistResult.error) {
    console.error("Failed to persist chat messages:", persistResult.error.message);
    return { ok: false, reason: "error", conversationId };
  }
  return { ok: true, conversationId, ...(conversationTitle ? { conversationTitle } : {}) };
}
