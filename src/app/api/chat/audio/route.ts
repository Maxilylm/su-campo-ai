import { NextRequest, NextResponse } from "next/server";
import { requireFarm } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { enforceAIWriteAccess, transcribeAudio, processMessage, executeOperations, readConversationHistory, requireAIConfirmation } from "@/lib/ai";
import { persistChatTurn, resolveConversationTarget } from "@/lib/chat-conversations-server";
import { conversationNotFound, conversationUnavailable } from "@/lib/chat-conversation-responses";
import { canWriteFarm } from "@/lib/farm-access";
import { checkRateLimit } from "@/lib/rate-limit";
import { SUPABASE_READ_TIMEOUT_MS, withTimeout } from "@/lib/timeout";
import { applyAIChangeFeedback } from "@/lib/chat-operation-errors";
import { AI_CONTEXT_UNAVAILABLE_CODE, AI_CONTEXT_UNAVAILABLE_MESSAGE, AI_RATE_LIMITED_CODE, AI_RATE_LIMITED_MESSAGE, aiRateLimitRetryAfterSec, isAIFarmContextUnavailableError, isAIRateLimitedError } from "@/lib/ai-errors";
import {
  claimChatRequest,
  completeChatRequest,
  markChatRequestFailed,
  markChatRequestSideEffectsDone,
  normalizeChatRequestId,
} from "@/lib/chat-idempotency";
import { claimConfirmedProposal } from "@/lib/ai-confirmed-requests";
import { verifyAIConfirmation } from "@/lib/ai-confirmation";
import { isBareAIConfirmation, isExplicitAIConfirmation } from "@/lib/ai-confirmation-text";

// Vercel's serverless function body limit is 4.5 MB; anything close to or
// above that never reaches this handler (it's rejected upstream with a
// platform error the client can't parse), so we must reject well under it
// and never rely on that upstream cutoff alone.
const MAX_AUDIO_REQUEST_BYTES = 4.5 * 1024 * 1024;
const MAX_AUDIO_FILE_BYTES = 4 * 1024 * 1024;
const AUDIO_REQUEST_BUDGET_MS = 24_000;
const AUDIO_TRANSCRIPTION_MAX_MS = 10_000;
const AUDIO_AI_PHASE_MAX_MS = 14_000;
const AUDIO_SIDE_EFFECT_RESERVE_MS = 5_000;
const AUDIO_MIN_OPERATION_BUDGET_MS = 2_000;

// Audio has two bounded upstream calls (transcription and chat completion).
// Match the app's AI timeout contract instead of falling back to Vercel's
// shorter default function window.
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const requestDeadline = Date.now() + AUDIO_REQUEST_BUDGET_MS;
  const remainingMs = () => Math.max(0, requestDeadline - Date.now());

  try {
    const contentLengthHeader = req.headers.get("content-length");
    const declaredLength = Number(contentLengthHeader);
    if (!contentLengthHeader || !Number.isFinite(declaredLength)) {
      return NextResponse.json({ error: "Falta el encabezado Content-Length." }, { status: 411 });
    }
    if (declaredLength > MAX_AUDIO_REQUEST_BYTES) {
      return NextResponse.json({ error: "El audio es demasiado grande (máximo 4 MB)." }, { status: 413 });
    }

    const result = await requireFarm();
    if ("error" in result) return result.error;

    const limit = await checkRateLimit(result.farmId);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "Demasiados mensajes seguidos. Esperá un momento e intentá de nuevo." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } }
      );
    }

    const formData = await req.formData();
    const audioFile = formData.get("audio") as Blob | null;

    if (!audioFile) {
      return NextResponse.json({ error: "No se recibió ningún audio." }, { status: 400 });
    }
    if (audioFile.type && !audioFile.type.startsWith("audio/")) {
      return NextResponse.json({ error: "El archivo enviado no es un audio válido." }, { status: 415 });
    }
    if (audioFile.size > MAX_AUDIO_FILE_BYTES) {
      return NextResponse.json({ error: "El audio es demasiado grande (máximo 4 MB)." }, { status: 413 });
    }

    const confirmationTokenValue = formData.get("confirmationToken");
    const confirmationToken = typeof confirmationTokenValue === "string" ? confirmationTokenValue : null;
    const confirmation = confirmationToken
      ? verifyAIConfirmation(confirmationToken, result.farmId, result.userId)
      : null;
    const requestId = normalizeChatRequestId(req.headers.get("Idempotency-Key"));
    if (confirmationToken && !confirmation) {
      return NextResponse.json({ error: "La confirmación no es válida o venció. Generá la propuesta nuevamente." }, { status: 400 });
    }
    if (confirmation && (!requestId || requestId !== confirmation.requestId)) {
      return NextResponse.json({ error: "La confirmación necesita una clave de reintento válida. Intentá usar el botón de confirmación nuevamente." }, { status: 400 });
    }
    if (confirmation && !canWriteFarm(result.role)) {
      return NextResponse.json({ error: "Tu acceso es de solo lectura y no puede aplicar cambios." }, { status: 403 });
    }
    const db = getSupabaseAdmin();
    // Which conversation this turn reads its history from and is saved to
    // (an empty conversationId field = start a new one).
    const target = await resolveConversationTarget(db, result.farmId, {
      present: formData.has("conversationId"),
      id: formData.get("conversationId"),
    }, Math.min(SUPABASE_READ_TIMEOUT_MS, Math.max(1, remainingMs())));
    if (target.kind === "not_found") return conversationNotFound();
    if (target.kind === "unavailable") return conversationUnavailable();

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

    const failClaim = async () => {
      if (!requestClaimed || !requestId) return;
      // Claim cleanup is best-effort and must not consume the rest of the
      // request budget after a read-only stage has already timed out.
      await withTimeout(
        markChatRequestFailed(db, result.farmId, requestId, Math.min(1_500, Math.max(1, remainingMs()))),
        Math.min(1_500, Math.max(1, remainingMs())),
        undefined,
      );
    };

    // Convert blob to buffer for Whisper
    const arrayBuffer = await audioFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Transcribe
    let transcription: string;
    try {
      const transcriptionTimeoutMs = Math.min(AUDIO_TRANSCRIPTION_MAX_MS, Math.max(1, remainingMs()));
      const transcribed = await withTimeout(
        transcribeAudio(buffer, transcriptionTimeoutMs),
        transcriptionTimeoutMs,
        null,
      );
      if (!transcribed) {
        await failClaim();
        return NextResponse.json(
          { error: "La transcripción del audio tardó demasiado. Intentá nuevamente.", code: "audio_transcription_timeout" },
          { status: 504 },
        );
      }
      transcription = transcribed;
    } catch (error) {
      await failClaim();
      throw error;
    }

    if (!transcription.trim()) {
      await failClaim();
      return NextResponse.json({
        intent: "help",
        response: "No pude entender el audio. Intenta de nuevo.",
        transcription: "",
      });
    }

    // Claim the single-use proposal only once the audio is known to say
    // "confirmo": the claim can't be undone, so claiming before transcription
    // turned a timeout or a misheard word into "Esta confirmación ya se aplicó"
    // on every retry, with nothing written.
    if (confirmation && !isExplicitAIConfirmation(transcription)) {
      await failClaim();
      return NextResponse.json({ error: "La confirmación de audio no fue clara. Decí confirmar para aplicar la propuesta." }, { status: 400 });
    }

    // Single-use guard for confirmed proposals, independent of chat_requests
    // (which "Limpiar historial" deletes, silently re-enabling replay of a
    // still-signature-valid token within its 10-minute TTL).
    if (confirmation) {
      const proposalClaim = await claimConfirmedProposal(db, result.farmId, confirmation.requestId);
      if (proposalClaim === "already_used") {
        await failClaim();
        return NextResponse.json({ error: "Esta confirmación ya se aplicó. Pedí la propuesta de nuevo si querés repetir el cambio." }, { status: 409 });
      }
      if (proposalClaim === "unavailable") {
        await failClaim();
        return NextResponse.json({ error: "No se pudo verificar la confirmación de forma segura. Intentá nuevamente.", code: "chat_confirmation_guard_unavailable" }, { status: 503 });
      }
    }

    // Process with AI
    let aiResult;
    try {
      const aiTimeoutMs = Math.min(AUDIO_AI_PHASE_MAX_MS, Math.max(1, remainingMs()));
      aiResult = confirmation
        ? {
          intent: "update" as const,
          response: "Aplicando la propuesta confirmada…",
          dbOperations: confirmation.operations,
          ...(confirmation.proposalRequestId ? { confirmedProposalRequestId: confirmation.proposalRequestId } : {}),
        }
        : await withTimeout(
          processMessage(result.farmId, transcription, "audio", readConversationHistory(result.farmId, target, Math.min(SUPABASE_READ_TIMEOUT_MS, Math.max(1, remainingMs()))), canWriteFarm(result.role)),
          aiTimeoutMs,
          null,
        );
      if (!aiResult) {
        await failClaim();
        return NextResponse.json(
          { error: "El procesamiento del audio tardó demasiado. Intentá nuevamente.", code: "chat_timeout" },
          { status: 504 },
        );
      }
    } catch (error) {
      await failClaim();
      if (isAIFarmContextUnavailableError(error)) {
        return NextResponse.json({ error: AI_CONTEXT_UNAVAILABLE_MESSAGE, code: AI_CONTEXT_UNAVAILABLE_CODE }, { status: 503 });
      }
      if (isAIRateLimitedError(error)) {
        const retryAfterSec = aiRateLimitRetryAfterSec(error);
        return NextResponse.json(
          { error: AI_RATE_LIMITED_MESSAGE, code: AI_RATE_LIMITED_CODE },
          { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
        );
      }
      throw error;
    }

    if (!confirmation && isBareAIConfirmation(transcription) && aiResult.dbOperations?.length) {
      aiResult = {
        intent: "help" as const,
        response: "Para aplicar una propuesta necesito la confirmación vinculada al pedido original. Volvé a abrir el handoff o describí nuevamente el cambio que querés guardar.",
        dbOperations: [],
      };
    }
    aiResult = enforceAIWriteAccess(aiResult, canWriteFarm(result.role));
    if (!confirmation) aiResult = await requireAIConfirmation(result.farmId, result.userId, transcription, aiResult, requestId);

    let operationErrors: string[] = [];
    const executedOperations = Boolean(aiResult.dbOperations?.length);
    if (aiResult.dbOperations && aiResult.dbOperations.length > 0) {
      const operationBudgetMs = remainingMs() - AUDIO_SIDE_EFFECT_RESERVE_MS;
      if (operationBudgetMs < AUDIO_MIN_OPERATION_BUDGET_MS) {
        await failClaim();
        return NextResponse.json(
          { error: "El audio se entendió, pero no quedó tiempo suficiente para aplicar los cambios. Intentá nuevamente.", code: "audio_operations_timeout" },
          { status: 504 },
        );
      }
      const logs = await executeOperations(result.farmId, aiResult.dbOperations, operationBudgetMs, requestId);
      operationErrors = logs.filter((l) => l.startsWith("Error") || l.startsWith("Exception"));
      if (operationErrors.length > 0) {
        console.error("Audio chat DB errors:", operationErrors);
      }
    }

    applyAIChangeFeedback(aiResult, aiResult.dbOperations, operationErrors);

    if (requestClaimed && requestId && executedOperations) {
      await markChatRequestSideEffectsDone(
        db,
        result.farmId,
        requestId,
        { ...aiResult, transcription },
        Math.min(1_500, Math.max(1, remainingMs())),
      );
    }

    // Persist before reporting success so the UI never confirms a lost message.
    const persisted = await persistChatTurn(db, {
      farmId: result.farmId,
      userId: result.userId,
      authorRole: result.role,
      target,
      userContent: `🎤 ${transcription}`,
      assistantContent: aiResult.response,
      timeoutMs: Math.min(SUPABASE_READ_TIMEOUT_MS, Math.max(1, remainingMs())),
    });
    if (!persisted.ok) {
      const conversation = persisted.conversationId ? { conversationId: persisted.conversationId } : {};
      return persisted.reason === "timeout"
        ? NextResponse.json(
          { error: "El audio se procesó, pero guardar el historial tardó demasiado. Intentá nuevamente.", code: "chat_persist_timeout", ...conversation },
          { status: 504 },
        )
        : NextResponse.json({ error: "El audio se procesó, pero no pudo guardarse.", ...conversation }, { status: 503 });
    }

    const response = {
      ...aiResult,
      transcription,
      conversationId: persisted.conversationId,
      ...(persisted.conversationTitle ? { conversationTitle: persisted.conversationTitle } : {}),
    };
    if (requestClaimed && requestId) {
      await completeChatRequest(db, result.farmId, requestId, response, Math.min(1_000, Math.max(1, remainingMs())));
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error("Audio chat error:", error);
    if (error instanceof Error && error.name === "AbortError") {
      return NextResponse.json(
        { error: "El procesamiento del audio tardó demasiado. Intentá nuevamente.", code: "chat_timeout" },
        { status: 504 },
      );
    }
    return NextResponse.json({ error: "No se pudo procesar el audio." }, { status: 500 });
  }
}
