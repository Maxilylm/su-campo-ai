import { NextRequest, NextResponse } from "next/server";
import { requireFarm } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { transcribeAudio, processMessage, executeOperations, ChatHistoryMessage } from "@/lib/ai";
import { checkRateLimit } from "@/lib/rate-limit";
import { SUPABASE_READ_TIMEOUT_MS, withTimeout } from "@/lib/timeout";

const MAX_AUDIO_REQUEST_BYTES = 12 * 1024 * 1024;
const MAX_AUDIO_FILE_BYTES = 10 * 1024 * 1024;

// Audio has two bounded upstream calls (transcription and chat completion).
// Match the app's AI timeout contract instead of falling back to Vercel's
// shorter default function window.
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const declaredLength = Number(req.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_AUDIO_REQUEST_BYTES) {
      return NextResponse.json({ error: "El audio es demasiado grande (máximo 10 MB)." }, { status: 413 });
    }

    const result = await requireFarm();
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

    // Convert blob to buffer for Whisper
    const arrayBuffer = await audioFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Transcribe
    const transcription = await transcribeAudio(buffer);

    if (!transcription.trim()) {
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
    const aiResult = await processMessage(result.farmId, transcription, "audio", chatHistory);

    let operationErrors: string[] = [];
    if (aiResult.dbOperations && aiResult.dbOperations.length > 0) {
      const logs = await executeOperations(result.farmId, aiResult.dbOperations);
      operationErrors = logs.filter((l) => l.startsWith("Error") || l.startsWith("Exception"));
      if (operationErrors.length > 0) {
        console.error("Audio chat DB errors:", operationErrors);
      }
    }

    if (operationErrors.length > 0) {
      aiResult.response += "\n\n⚠️ Algunos cambios no se guardaron correctamente. Intenta de nuevo.";
    }

    // Persist before reporting success so the UI never confirms a lost message.
    const db = getSupabaseAdmin();
    const persistResult = await withTimeout(
      db.from("chat_messages")
        .insert([
          { farm_id: result.farmId, role: "user", content: `🎤 ${transcription}` },
          { farm_id: result.farmId, role: "assistant", content: aiResult.response },
        ]),
      SUPABASE_READ_TIMEOUT_MS,
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

    return NextResponse.json({ ...aiResult, transcription });
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
