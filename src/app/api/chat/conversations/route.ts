import { NextRequest, NextResponse } from "next/server";
import { requireFarm } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { canWriteFarm } from "@/lib/farm-access";
import { parseJsonBody } from "@/lib/request";
import { SUPABASE_READ_TIMEOUT_MS, withTimeout } from "@/lib/timeout";
import {
  DEFAULT_CONVERSATION_TITLE,
  normalizeConversationId,
  normalizeConversationTitle,
  type ChatConversationSummary,
} from "@/lib/chat-conversations";
import { CONVERSATION_COLUMNS, createConversation, isMissingConversationSchema } from "@/lib/chat-conversations-server";
import { conversationNotFound } from "@/lib/chat-conversation-responses";

// Conversations of the AI chat (migration 052). Shared per farm: every member
// sees the list; owners and editors delete, and whoever started a conversation
// may also rename it. Until 052 is applied, GET answers { available: false }
// and the Chat page keeps the single shared thread.

const PAGE_DEFAULT = 30;
const PAGE_MAX = 50;

function migrationRequired() {
  return NextResponse.json(
    { error: "Aplicá la migración 052_chat_conversations.sql para guardar conversaciones.", code: "chat_conversations_migration_required" },
    { status: 503 },
  );
}

function timeout(action: string) {
  return NextResponse.json({ error: `${action} tardó demasiado. Intentá nuevamente.` }, { status: 504 });
}

function failure(context: string, message: string | undefined, userMessage: string) {
  console.error(`Chat conversations ${context} failed:`, message);
  return NextResponse.json({ error: userMessage }, { status: 503 });
}

/** Cursor = "<updated_at>|<id>" of the last item of the previous page. */
function parseCursor(value: string | null): { updatedAt: string; id: string } | null {
  if (!value) return null;
  const separator = value.lastIndexOf("|");
  if (separator < 0) return null;
  const updatedAt = value.slice(0, separator);
  const id = normalizeConversationId(value.slice(separator + 1));
  if (!id || !Number.isFinite(Date.parse(updatedAt)) || /[",()]/.test(updatedAt)) return null;
  return { updatedAt, id };
}

// GET: list, most recent first. ?limit= (1–50) and ?cursor= for the next page.
export async function GET(req: NextRequest) {
  try {
    const result = await requireFarm();
    if ("error" in result) return result.error;

    const params = req.nextUrl.searchParams;
    const requestedLimit = Number(params.get("limit"));
    const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, PAGE_MAX) : PAGE_DEFAULT;
    const cursorParam = params.get("cursor");
    const cursor = parseCursor(cursorParam);
    if (cursorParam && !cursor) return NextResponse.json({ error: "Cursor inválido." }, { status: 400 });

    let query = getSupabaseAdmin()
      .from("chat_conversations")
      .select(CONVERSATION_COLUMNS)
      .eq("farm_id", result.farmId)
      .is("archived_at", null);
    if (cursor) {
      query = query.or(`updated_at.lt."${cursor.updatedAt}",and(updated_at.eq."${cursor.updatedAt}",id.lt.${cursor.id})`);
    }
    const listResult = await withTimeout(
      query
        .order("updated_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(limit + 1),
      SUPABASE_READ_TIMEOUT_MS,
      null,
    );
    if (!listResult) return timeout("Cargar las conversaciones");
    if (listResult.error) {
      if (isMissingConversationSchema(listResult.error)) {
        return NextResponse.json({ available: false, conversations: [], nextCursor: null, canManage: canWriteFarm(result.role) });
      }
      return failure("list", listResult.error.message, "No se pudieron cargar las conversaciones.");
    }

    const rows = (listResult.data || []) as ChatConversationSummary[];
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return NextResponse.json({
      available: true,
      conversations: page,
      nextCursor: rows.length > limit && last ? `${last.updated_at}|${last.id}` : null,
      canManage: canWriteFarm(result.role),
      userId: result.userId,
    });
  } catch (error) {
    console.error("Chat conversations GET error:", error);
    return NextResponse.json({ error: "No se pudieron cargar las conversaciones." }, { status: 500 });
  }
}

// POST: create an empty conversation. The Chat page normally lets /api/chat
// create it with the first message; this is for clients that need the id first.
export async function POST(req: NextRequest) {
  try {
    const result = await requireFarm();
    if ("error" in result) return result.error;
    const parsed = await parseJsonBody(req, 4_000);
    if ("error" in parsed) return parsed.error;
    const title = parsed.data.title === undefined || parsed.data.title === null
      ? DEFAULT_CONVERSATION_TITLE
      : normalizeConversationTitle(parsed.data.title);
    if (!title) return NextResponse.json({ error: "El título debe tener entre 1 y 120 caracteres." }, { status: 400 });

    const created = await createConversation(getSupabaseAdmin(), { farmId: result.farmId, userId: result.userId, title });
    if (created.kind === "legacy") return migrationRequired();
    if (created.kind === "error") return NextResponse.json({ error: "No se pudo crear la conversación. Intentá nuevamente." }, { status: 503 });
    return NextResponse.json({ conversation: created.conversation }, { status: 201 });
  } catch (error) {
    console.error("Chat conversations POST error:", error);
    return NextResponse.json({ error: "No se pudo crear la conversación." }, { status: 500 });
  }
}

// PATCH: rename. { id, title }
export async function PATCH(req: NextRequest) {
  try {
    const result = await requireFarm();
    if ("error" in result) return result.error;
    const parsed = await parseJsonBody(req, 4_000);
    if ("error" in parsed) return parsed.error;
    const id = normalizeConversationId(parsed.data.id);
    if (!id) return NextResponse.json({ error: "Falta indicar la conversación." }, { status: 400 });
    const title = normalizeConversationTitle(parsed.data.title);
    if (!title) return NextResponse.json({ error: "El título debe tener entre 1 y 120 caracteres." }, { status: 400 });

    let update = getSupabaseAdmin()
      .from("chat_conversations")
      .update({ title })
      .eq("id", id)
      .eq("farm_id", result.farmId);
    // Viewers may rename only the conversations they started.
    if (!canWriteFarm(result.role)) update = update.eq("created_by", result.userId);
    const updateResult = await withTimeout(update.select(CONVERSATION_COLUMNS).maybeSingle(), SUPABASE_READ_TIMEOUT_MS, null);
    if (!updateResult) return timeout("Renombrar la conversación");
    if (updateResult.error) {
      if (isMissingConversationSchema(updateResult.error)) return migrationRequired();
      return failure("rename", updateResult.error.message, "No se pudo renombrar la conversación.");
    }
    if (!updateResult.data) return conversationNotFound();
    return NextResponse.json({ conversation: updateResult.data });
  } catch (error) {
    console.error("Chat conversations PATCH error:", error);
    return NextResponse.json({ error: "No se pudo renombrar la conversación." }, { status: 500 });
  }
}

// DELETE: a conversation and (FK cascade) its messages. { id } — owners and editors.
// chat_requests is left alone: it is farm-wide, other conversations' pending
// proposals live there, and a deleted conversation's proposals can no longer
// be shown (they attach to its messages). ai_confirmed_requests (044) keeps
// confirmed proposals single-use either way.
export async function DELETE(req: NextRequest) {
  try {
    const result = await requireFarm({ write: true });
    if ("error" in result) return result.error;
    const parsed = await parseJsonBody(req, 4_000);
    if ("error" in parsed) return parsed.error;
    const id = normalizeConversationId(parsed.data.id);
    if (!id) return NextResponse.json({ error: "Falta indicar la conversación." }, { status: 400 });

    const deleteResult = await withTimeout(
      getSupabaseAdmin()
        .from("chat_conversations")
        .delete()
        .eq("id", id)
        .eq("farm_id", result.farmId)
        .select("id")
        .maybeSingle(),
      SUPABASE_READ_TIMEOUT_MS,
      null,
    );
    if (!deleteResult) return timeout("Eliminar la conversación");
    if (deleteResult.error) {
      if (isMissingConversationSchema(deleteResult.error)) return migrationRequired();
      return failure("delete", deleteResult.error.message, "No se pudo eliminar la conversación.");
    }
    if (!deleteResult.data) return conversationNotFound();
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Chat conversations DELETE error:", error);
    return NextResponse.json({ error: "No se pudo eliminar la conversación." }, { status: 500 });
  }
}
