import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import { requireFarm } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { enforceAIWriteAccess, processMessage, executeOperations, readSharedChatHistory, requireAIConfirmation } from "@/lib/ai";
import { canWriteFarm } from "@/lib/farm-access";
import { checkRateLimit } from "@/lib/rate-limit";
import { parseJsonBody } from "@/lib/request";
import { SUPABASE_READ_TIMEOUT_MS, withTimeout } from "@/lib/timeout";
import { applyAIChangeFeedback } from "@/lib/chat-operation-errors";
import { AI_CONTEXT_UNAVAILABLE_CODE, AI_CONTEXT_UNAVAILABLE_MESSAGE, isAIFarmContextUnavailableError } from "@/lib/ai-errors";
import {
  claimChatRequest,
  completeChatRequest,
  markChatRequestFailed,
  markChatRequestSideEffectsDone,
  normalizeChatRequestId,
} from "@/lib/chat-idempotency";
import { verifyAIConfirmation } from "@/lib/ai-confirmation";
import { isBareAIConfirmation, isExplicitAIConfirmation } from "@/lib/ai-confirmation-text";

// Groq can take longer than the platform's default request window. Keep the
// route alive for the same bounded period used by the upstream AI request so
// a valid response is not cut off by the hosting platform first.
export const maxDuration = 30;
const CHAT_AI_PHASE_TIMEOUT_MS = 20_000;
const CHAT_PENDING_CONFIRMATION_TIMEOUT_MS = 1_500;

interface PendingConfirmationSnapshot {
  responseText: string;
  token: string;
  requestId: string;
  expiresAt: number;
  proposalRequestId: string;
}

function recordValue(record: unknown, key: string): unknown {
  if (!record || typeof record !== "object" || Array.isArray(record)) return undefined;
  return (record as Record<string, unknown>)[key];
}

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

    const pendingResult = canWriteFarm(result.role)
      ? await withTimeout(
        db
          .from("chat_requests")
          .select("status, response")
          .eq("farm_id", result.farmId)
          .in("status", ["completed", "side_effects_done"])
          .order("updated_at", { ascending: false })
          .limit(30),
        CHAT_PENDING_CONFIRMATION_TIMEOUT_MS,
        null,
      )
      : null;
    const consumedProposalIds = new Set<string>();
    const pendingCandidates: PendingConfirmationSnapshot[] = [];
    if (pendingResult?.data) {
      for (const row of pendingResult.data) {
        const response = row.response;
        const consumedProposalId = recordValue(response, "confirmedProposalRequestId");
        if (typeof consumedProposalId === "string") consumedProposalIds.add(consumedProposalId);

        const responseText = recordValue(response, "response");
        const token = recordValue(response, "pendingConfirmationToken");
        const requestId = recordValue(response, "pendingConfirmationRequestId");
        const expiresAt = recordValue(response, "pendingConfirmationExpiresAt");
        const proposalRequestId = recordValue(response, "pendingConfirmationProposalRequestId");
        if (typeof responseText === "string"
          && typeof token === "string"
          && typeof requestId === "string"
          && typeof expiresAt === "number"
          && expiresAt > Date.now()
          && typeof proposalRequestId === "string") {
          pendingCandidates.push({ responseText, token, requestId, expiresAt, proposalRequestId });
        }
      }
    } else if (pendingResult?.error) {
      // Older deployments may not have the retry table yet. Chat history is
      // still useful; only the restoreable confirmation affordance is absent.
      console.warn("Pending AI confirmation lookup unavailable:", pendingResult.error.message);
    }

    const pendingConfirmations = pendingCandidates.filter((candidate) => !consumedProposalIds.has(candidate.proposalRequestId));
    return NextResponse.json({ messages: data || [], pendingConfirmations });
  } catch (error) {
    console.error("Chat history API error:", error);
    return NextResponse.json({ error: "No se pudo cargar el historial." }, { status: 503 });
  }
}

// POST: send message + get AI response
export async function POST(req: NextRequest) {
  try {
    const result = await requireFarm();
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
    const { message } = parsed.data;
    if (typeof message !== "string" || !message.trim()) {
      return NextResponse.json({ error: "Escribí un mensaje para continuar." }, { status: 400 });
    }
    if (message.length > 4000) {
      return NextResponse.json({ error: "El mensaje es demasiado largo (máximo 4000 caracteres)." }, { status: 413 });
    }

    const confirmationToken = typeof parsed.data.confirmationToken === "string"
      ? parsed.data.confirmationToken
      : null;
    const confirmation = confirmationToken
      ? verifyAIConfirmation(confirmationToken, result.farmId)
      : null;
    if (confirmationToken && (!confirmation || !isExplicitAIConfirmation(message))) {
      return NextResponse.json({ error: "La confirmación no es válida o venció. Generá la propuesta nuevamente." }, { status: 400 });
    }

    const requestId = normalizeChatRequestId(req.headers.get("Idempotency-Key"));
    if (confirmation && (!requestId || requestId !== confirmation.requestId)) {
      return NextResponse.json({ error: "La confirmación necesita una clave de reintento válida. Intentá usar el botón de confirmación nuevamente." }, { status: 400 });
    }
    if (confirmation && !canWriteFarm(result.role)) {
      return NextResponse.json({ error: "Tu acceso es de solo lectura y no puede aplicar cambios." }, { status: 403 });
    }
    const db = getSupabaseAdmin();
    let requestClaimed = false;
    if (requestId) {
      const claim = await claimChatRequest(db, result.farmId, requestId);
      if (claim.kind === "unavailable") {
        return NextResponse.json({ error: "No se pudo verificar el reintento de forma segura. Intentá nuevamente.", code: "chat_retry_guard_unavailable" }, { status: 503 });
      }
      if (confirmation && claim.kind === "disabled") {
        return NextResponse.json({ error: "No se pudo verificar la confirmación de forma segura. Aplicá la migración de reintentos y volvé a intentar.", code: "chat_confirmation_guard_unavailable" }, { status: 503 });
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

    let aiResult;
    try {
      // Context loading is bounded to 7s and the Groq completion to 15s.
      // Keep the whole read-only AI phase bounded as well, so a slow context
      // query cannot push the route into Vercel's invocation timeout.
      aiResult = confirmation
        ? {
          intent: "update" as const,
          response: "Aplicando la propuesta confirmada…",
          dbOperations: confirmation.operations,
          ...(confirmation.proposalRequestId ? { confirmedProposalRequestId: confirmation.proposalRequestId } : {}),
        }
        : await withTimeout(
          processMessage(result.farmId, message, "text", readSharedChatHistory(result.farmId), canWriteFarm(result.role)),
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

    if (!confirmation && isBareAIConfirmation(message) && aiResult.dbOperations?.length) {
      aiResult = {
        intent: "help" as const,
        response: "Para aplicar una propuesta necesito la confirmación vinculada al pedido original. Volvé a abrir el handoff o describí nuevamente el cambio que querés guardar.",
        dbOperations: [],
      };
    }
    aiResult = enforceAIWriteAccess(aiResult, canWriteFarm(result.role));
    if (!confirmation) aiResult = requireAIConfirmation(result.farmId, message, aiResult, requestId);

    let operationErrors: string[] = [];
    const executedOperations = Boolean(aiResult.dbOperations?.length);
    if (aiResult.dbOperations && aiResult.dbOperations.length > 0) {
      const logs = await executeOperations(result.farmId, aiResult.dbOperations);
      operationErrors = logs.filter((l) => l.startsWith("Error") || l.startsWith("Exception"));
      if (operationErrors.length > 0) {
        console.error("Chat DB operation errors:", operationErrors);
      }
    }

    applyAIChangeFeedback(aiResult, aiResult.dbOperations, operationErrors);

    if (requestClaimed && requestId && executedOperations) {
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
