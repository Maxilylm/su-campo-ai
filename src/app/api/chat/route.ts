import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import { requireFarm } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { processMessage, executeOperations, ChatHistoryMessage } from "@/lib/ai";
import { checkRateLimit } from "@/lib/rate-limit";
import { parseJsonBody } from "@/lib/request";
import { SUPABASE_READ_TIMEOUT_MS, withTimeout } from "@/lib/timeout";
import { applyAIChangeFeedback } from "@/lib/chat-operation-errors";
import { AI_CONTEXT_UNAVAILABLE_CODE, AI_CONTEXT_UNAVAILABLE_MESSAGE, isAIFarmContextUnavailableError } from "@/lib/ai-errors";
import { normalizeClientChatHistory } from "@/lib/ai-conversation";
import {
  claimChatRequest,
  completeChatRequest,
  markChatRequestFailed,
  markChatRequestSideEffectsDone,
  normalizeChatRequestId,
} from "@/lib/chat-idempotency";

// Groq can take longer than the platform's default request window. Keep the
// route alive for the same bounded period used by the upstream AI request so
// a valid response is not cut off by the hosting platform first.
export const maxDuration = 30;
const CHAT_AI_PHASE_TIMEOUT_MS = 20_000;

// GET: load chat history
export async function GET() {
  try {
    const result = await requireFarm();
    if ("error" in result) return result.error;

    const db = getSupabaseAdmin();
    const queryResult = await withTimeout(
      db
        .from("chat_messages")
        .select("role, content, created_at")
        .eq("farm_id", result.farmId)
        .order("created_at", { ascending: true })
        .limit(100),
      SUPABASE_READ_TIMEOUT_MS,
      null,
    );
    if (!queryResult) {
      return NextResponse.json({ error: "El historial del chat tardó demasiado. Intentá nuevamente." }, { status: 504 });
    }
    const { data, error } = queryResult;

    if (error) {
      console.error("Chat history query failed:", error.message);
      return NextResponse.json({ error: "No se pudo cargar el historial." }, { status: 503 });
    }

    return NextResponse.json({ messages: data || [] });
  } catch (error) {
    console.error("Chat history API error:", error);
    return NextResponse.json({ error: "No se pudo cargar el historial." }, { status: 503 });
  }
}

// POST: send message + get AI response
export async function POST(req: NextRequest) {
  try {
    const result = await requireFarm({ write: true });
    if ("error" in result) return result.error;

    const limit = checkRateLimit(result.farmId);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "Demasiados mensajes seguidos. Esperá un momento e intentá de nuevo." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } }
      );
    }

    const parsed = await parseJsonBody(req);
    if ("error" in parsed) return parsed.error;
    const { message, history } = parsed.data;
    if (typeof message !== "string" || !message.trim()) {
      return NextResponse.json({ error: "Escribí un mensaje para continuar." }, { status: 400 });
    }
    if (message.length > 4000) {
      return NextResponse.json({ error: "El mensaje es demasiado largo (máximo 4000 caracteres)." }, { status: 413 });
    }

    const requestId = normalizeChatRequestId(req.headers.get("Idempotency-Key"));
    const db = getSupabaseAdmin();
    let requestClaimed = false;
    if (requestId) {
      const claim = await claimChatRequest(db, result.farmId, requestId);
      if (claim.kind === "unavailable") {
        return NextResponse.json({ error: "No se pudo verificar el reintento de forma segura. Intentá nuevamente.", code: "chat_retry_guard_unavailable" }, { status: 503 });
      }
      if (claim.kind === "replay") return NextResponse.json(claim.response);
      if (claim.kind === "in_progress") {
        return NextResponse.json(
          { error: claim.status === "side_effects_done" ? "La solicitud ya aplicó cambios y está terminando de guardar el historial. Actualizá el chat antes de reintentar." : "La solicitud anterior todavía se está procesando. Esperá un momento antes de reintentar.", code: "chat_request_in_progress" },
          { status: 409 },
        );
      }
      requestClaimed = claim.kind === "claimed";
    }

    // Use the same history contract as WhatsApp and persisted Chat messages.
    const chatHistory: ChatHistoryMessage[] = normalizeClientChatHistory(history);

    let aiResult;
    try {
      // Context loading is bounded to 7s and the Groq completion to 15s.
      // Keep the whole read-only AI phase bounded as well, so a slow context
      // query cannot push the route into Vercel's invocation timeout.
      aiResult = await withTimeout(
        processMessage(result.farmId, message, "text", chatHistory),
        CHAT_AI_PHASE_TIMEOUT_MS,
        null,
      );
      if (!aiResult) {
        if (requestClaimed && requestId) await markChatRequestFailed(db, result.farmId, requestId);
        return NextResponse.json(
          { error: "El procesamiento del chat tardó demasiado. Intentá nuevamente.", code: "chat_timeout" },
          { status: 504 },
        );
      }
    } catch (error) {
      if (requestClaimed && requestId) await markChatRequestFailed(db, result.farmId, requestId);
      if (isAIFarmContextUnavailableError(error)) {
        return NextResponse.json({ error: AI_CONTEXT_UNAVAILABLE_MESSAGE, code: AI_CONTEXT_UNAVAILABLE_CODE }, { status: 503 });
      }
      throw error;
    }

    let operationErrors: string[] = [];
    if (aiResult.dbOperations && aiResult.dbOperations.length > 0) {
      const logs = await executeOperations(result.farmId, aiResult.dbOperations);
      operationErrors = logs.filter((l) => l.startsWith("Error") || l.startsWith("Exception"));
      if (operationErrors.length > 0) {
        console.error("Chat DB operation errors:", operationErrors);
      }
    }

    applyAIChangeFeedback(aiResult, aiResult.dbOperations, operationErrors);

    if (requestClaimed && requestId) {
      await markChatRequestSideEffectsDone(db, result.farmId, requestId, aiResult);
    }

    // Persist before reporting success so the UI never confirms a message
    // that was silently lost.
    const persistResult = await withTimeout(
      db.from("chat_messages")
        .insert([
          { farm_id: result.farmId, role: "user", content: message },
          { farm_id: result.farmId, role: "assistant", content: aiResult.response },
        ]),
      SUPABASE_READ_TIMEOUT_MS,
      null,
    );
    if (!persistResult) {
      return NextResponse.json(
        { error: "El mensaje se procesó, pero guardar el historial tardó demasiado. Intentá nuevamente.", code: "chat_persist_timeout" },
        { status: 504 },
      );
    }
    if (persistResult.error) {
      console.error("Failed to persist chat messages:", persistResult.error.message);
      return NextResponse.json({ error: "El mensaje se procesó, pero no pudo guardarse." }, { status: 503 });
    }

    if (requestClaimed && requestId) {
      await completeChatRequest(db, result.farmId, requestId, aiResult);
    }

    return NextResponse.json(aiResult);
  } catch (error) {
    console.error("Chat API error:", error);
    if (error instanceof Error && error.name === "AbortError") {
      return NextResponse.json(
        { error: "El procesamiento del chat tardó demasiado. Intentá nuevamente.", code: "chat_timeout" },
        { status: 504 },
      );
    }
    return NextResponse.json({ error: "No se pudo procesar el mensaje." }, { status: 500 });
  }
}

// DELETE: clear chat history
export async function DELETE() {
  try {
    const result = await requireFarm({ write: true });
    if ("error" in result) return result.error;

    const db = getSupabaseAdmin();
    const deleteResult = await withTimeout(
      db
        .from("chat_messages")
        .delete()
        .eq("farm_id", result.farmId),
      SUPABASE_READ_TIMEOUT_MS,
      null,
    );
    if (!deleteResult) {
      return NextResponse.json({ error: "Borrar el historial tardó demasiado. Intentá nuevamente.", code: "chat_delete_timeout" }, { status: 504 });
    }
    const { error } = deleteResult;

    if (error) {
      console.error("Failed to clear chat messages:", error.message);
      return NextResponse.json({ error: "No se pudo borrar el historial." }, { status: 503 });
    }

    const requestDelete = await withTimeout(
      db.from("chat_requests").delete().eq("farm_id", result.farmId),
      SUPABASE_READ_TIMEOUT_MS,
      null,
    );
    if (requestDelete?.error && !/chat_requests.*(?:does not exist|not found)/i.test(requestDelete.error.message || "") && requestDelete.error.code !== "PGRST205" && requestDelete.error.code !== "42P01") {
      console.error("Failed to clear chat request claims:", requestDelete.error.message);
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "No se pudo borrar el historial." }, { status: 500 });
  }
}
