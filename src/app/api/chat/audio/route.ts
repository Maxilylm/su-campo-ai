import { NextRequest, NextResponse } from "next/server";
import { requireFarm } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { transcribeAudio, processMessage, executeOperations, ChatHistoryMessage } from "@/lib/ai";
import { checkRateLimit } from "@/lib/rate-limit";
import { SUPABASE_READ_TIMEOUT_MS, withTimeout } from "@/lib/timeout";
import { annotateOperationErrors } from "@/lib/chat-operation-errors";
import { AI_CONTEXT_UNAVAILABLE_CODE, AI_CONTEXT_UNAVAILABLE_MESSAGE, isAIFarmContextUnavailableError } from "@/lib/ai-errors";
import {
  claimChatRequest,
  completeChatRequest,
  markChatRequestFailed,
  markChatRequestSideEffectsDone,
  normalizeChatRequestId,
} from "@/lib/chat-idempotency";

const MAX_AUDIO_REQUEST_BYTES = 12 * 1024 * 1024;
const MAX_AUDIO_FILE_BYTES = 10 * 1024 * 1024;
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
    const declaredLength = Number(req.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_AUDIO_REQUEST_BYTES) {
      return NextResponse.json({ error: "El audio es demasiado grande (máximo 10 MB)." }, { status: 413 });
    }

    const result = await requireFarm({ write: true });
    if ("error" in result) return result.error;

    const limit = checkRateLimit(result.farmId);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "Demasiados mensajes seguidos. Esperá un momento e intentá de nuevo." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } }
      );
    }

    const formData = await req.formData();
    const audioFile = formData.get("audio") as Blob | null;
    const historyRaw = formData.get("history") as string | null;

    if (!audioFile) {
      return NextResponse.json({ error: "No se recibió ningún audio." }, { status: 400 });
    }
    if (audioFile.type && !audioFile.type.startsWith("audio/")) {
      return NextResponse.json({ error: "El archivo enviado no es un audio válido." }, { status: 415 });
    }
    if (audioFile.size > MAX_AUDIO_FILE_BYTES) {
      return NextResponse.json({ error: "El audio es demasiado grande (máximo 10 MB)." }, { status: 413 });
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

    // Parse history
    let chatHistory: ChatHistoryMessage[] = [];
    if (historyRaw) {
      if (historyRaw.length > 120_000) {
        await failClaim();
        return NextResponse.json({ error: "El historial del chat es demasiado grande." }, { status: 413 });
      }
      try {
        const parsed = JSON.parse(historyRaw);
        chatHistory = Array.isArray(parsed)
          ? parsed
            .filter((m): m is { role: "user" | "assistant"; text: string } =>
              Boolean(m) && (m.role === "user" || m.role === "assistant") && typeof m.text === "string"
            )
            .slice(-20)
            .map((m) => ({ role: m.role, content: m.text.slice(0, 4000) }))
          : [];
      } catch {
        // ignore
      }
    }

    // Process with AI
    let aiResult;
    try {
      const aiTimeoutMs = Math.min(AUDIO_AI_PHASE_MAX_MS, Math.max(1, remainingMs()));
      aiResult = await withTimeout(
        processMessage(result.farmId, transcription, "audio", chatHistory),
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
      throw error;
    }

    let operationErrors: string[] = [];
    if (aiResult.dbOperations && aiResult.dbOperations.length > 0) {
      const operationBudgetMs = remainingMs() - AUDIO_SIDE_EFFECT_RESERVE_MS;
      if (operationBudgetMs < AUDIO_MIN_OPERATION_BUDGET_MS) {
        await failClaim();
        return NextResponse.json(
          { error: "El audio se entendió, pero no quedó tiempo suficiente para aplicar los cambios. Intentá nuevamente.", code: "audio_operations_timeout" },
          { status: 504 },
        );
      }
      const logs = await executeOperations(result.farmId, aiResult.dbOperations, operationBudgetMs);
      operationErrors = logs.filter((l) => l.startsWith("Error") || l.startsWith("Exception"));
      if (operationErrors.length > 0) {
        console.error("Audio chat DB errors:", operationErrors);
      }
    }

    annotateOperationErrors(aiResult, operationErrors);

    if (requestClaimed && requestId) {
      await markChatRequestSideEffectsDone(
        db,
        result.farmId,
        requestId,
        { ...aiResult, transcription },
        Math.min(1_500, Math.max(1, remainingMs())),
      );
    }

    // Persist before reporting success so the UI never confirms a lost message.
    const persistResult = await withTimeout(
      db.from("chat_messages")
        .insert([
          { farm_id: result.farmId, role: "user", content: `🎤 ${transcription}` },
          { farm_id: result.farmId, role: "assistant", content: aiResult.response },
        ]),
      Math.min(SUPABASE_READ_TIMEOUT_MS, Math.max(1, remainingMs())),
      null,
    );
    if (!persistResult) {
      return NextResponse.json(
        { error: "El audio se procesó, pero guardar el historial tardó demasiado. Intentá nuevamente.", code: "chat_persist_timeout" },
        { status: 504 },
      );
    }
    if (persistResult.error) {
      console.error("Failed to persist audio chat messages:", persistResult.error.message);
      return NextResponse.json({ error: "El audio se procesó, pero no pudo guardarse." }, { status: 503 });
    }

    const response = { ...aiResult, transcription };
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
