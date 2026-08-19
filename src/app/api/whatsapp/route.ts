import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { sendWhatsAppMessage, downloadWhatsAppMedia } from "@/lib/whatsapp";
import { transcribeAudio, processMessage, executeOperations, readSharedChatHistory } from "@/lib/ai";
import { whatsappConfig } from "@/lib/env";
import { verifyWhatsAppSignature } from "@/lib/whatsapp-signature";
import { isReplayableWhatsAppEvent } from "@/lib/whatsapp-retry";
import { withTimeout } from "@/lib/timeout";
import { persistedChatUserMessage } from "@/lib/ai-conversation";
import { AI_CONTEXT_UNAVAILABLE_CODE, isAIFarmContextUnavailableError } from "@/lib/ai-errors";
import { applyAIChangeFeedback } from "@/lib/chat-operation-errors";
import { isBareAIConfirmation } from "@/lib/ai-confirmation-text";

// WhatsApp is an OPTIONAL, experimental integration. When its Business API
// credentials are absent the app must keep working — this route just degrades.
const NOT_CONFIGURED = NextResponse.json(
  { error: "WhatsApp integration is not configured on this deployment." },
  { status: 503 }
);
const MAX_WEBHOOK_BODY_BYTES = 1_000_000;
const WHATSAPP_DB_TIMEOUT_MS = 5_000;
const WHATSAPP_CHAT_HISTORY_TIMEOUT_MS = 1_200;
const WHATSAPP_REQUEST_BUDGET_MS = 26_000;
const WHATSAPP_MEDIA_TIMEOUT_MS = 8_000;
const WHATSAPP_TRANSCRIPTION_TIMEOUT_MS = 9_000;
const WHATSAPP_AI_TIMEOUT_MS = 20_000;
const WHATSAPP_OPERATION_RESERVE_MS = 3_000;
const WHATSAPP_MIN_OPERATION_BUDGET_MS = 2_000;
export const maxDuration = 30;

class WhatsAppSupabaseTimeout extends Error {
  constructor() {
    super("WhatsApp Supabase operation timed out");
    this.name = "WhatsAppSupabaseTimeout";
  }
}

class WhatsAppAIRequestTimeout extends Error {
  constructor() {
    super("WhatsApp AI request timed out");
    this.name = "WhatsAppAIRequestTimeout";
  }
}

async function requireWhatsAppDb<T>(operation: PromiseLike<T>): Promise<T> {
  const result = await withTimeout(operation, WHATSAPP_DB_TIMEOUT_MS, null);
  if (result === null) throw new WhatsAppSupabaseTimeout();
  return result;
}

async function boundedWhatsAppDb<T>(operation: PromiseLike<T>, timeoutMs = WHATSAPP_DB_TIMEOUT_MS): Promise<T | null> {
  try {
    return await withTimeout(operation, timeoutMs, null);
  } catch {
    return null;
  }
}

// WhatsApp webhook verification (GET)
export async function GET(req: NextRequest) {
  const wa = whatsappConfig();
  if (!wa.configured) return NOT_CONFIGURED;

  const params = req.nextUrl.searchParams;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");

  if (mode === "subscribe" && wa.verifyToken && token === wa.verifyToken) {
    return new Response(challenge, { status: 200 });
  }
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

// WhatsApp incoming message (POST)
export async function POST(req: NextRequest) {
  const wa = whatsappConfig();
  if (!wa.configured) return NOT_CONFIGURED;
  // Fail closed: an unsigned webhook is an unauthenticated write path, so a
  // deployment without the app secret must reject POSTs rather than trust them.
  if (!wa.appSecret) {
    return NextResponse.json(
      { error: "WHATSAPP_APP_SECRET is not set; webhook POSTs are disabled." },
      { status: 503 }
    );
  }
  let markFailed: (() => Promise<void>) | null = null;
  const requestDeadline = Date.now() + WHATSAPP_REQUEST_BUDGET_MS;
  const remainingMs = () => Math.max(0, requestDeadline - Date.now());
  try {
    const declaredLength = Number(req.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_WEBHOOK_BODY_BYTES) {
      return NextResponse.json({ error: "Webhook payload too large" }, { status: 413 });
    }
    const rawBody = await req.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_WEBHOOK_BODY_BYTES) {
      return NextResponse.json({ error: "Webhook payload too large" }, { status: 413 });
    }
    if (!verifyWhatsAppSignature(rawBody, req.headers.get("x-hub-signature-256"), wa.appSecret)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
    // The provider's webhook envelope is intentionally kept loose; individual
    // fields are validated as they are consumed below.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let body: { entry?: Array<{ changes?: Array<{ value?: any }> }> };
    try {
      body = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const message = value?.messages?.[0];

    if (!message) {
      return NextResponse.json({ status: "no message" });
    }

    const from = message.from; // sender phone number
    const msgType = message.type; // text, audio, image, etc.

    // Get or create farm for this phone number
    const db = getSupabaseAdmin();
    let eventTracked = false;
    let eventRetrySafetyAvailable = false;
    const messageId = typeof message.id === "string" ? message.id : null;
    if (messageId) {
      const priorResult = await requireWhatsAppDb(db
        .from("whatsapp_events")
        .select("message_id, status, updated_at, response_text")
        .eq("message_id", messageId)
        .maybeSingle());
      const { data: prior, error: priorError } = priorResult;
      const missingEventsTable = priorError && ["42P01", "PGRST205"].includes(priorError.code || "");
      const missingResponseColumn = priorError?.code === "PGRST204"
        || /response_text.*(?:does not exist|not found)/i.test(priorError?.message || "");
      if (priorError && !missingEventsTable && !missingResponseColumn) throw priorError;
      eventRetrySafetyAvailable = !priorError && !missingEventsTable;
      if (prior?.status === "completed") return NextResponse.json({ status: "duplicate" });
      if (isReplayableWhatsAppEvent(prior)) {
        try {
          await sendWhatsAppMessage(from, prior.response_text);
          const replayUpdate = await boundedWhatsAppDb(db.from("whatsapp_events").update({ status: "completed", updated_at: new Date().toISOString() }).eq("message_id", messageId));
          if (replayUpdate?.error) console.error("WhatsApp replay status update failed:", replayUpdate.error.message);
          return NextResponse.json({ status: "replayed" });
        } catch (error) {
          console.error("WhatsApp response replay failed:", error);
          return NextResponse.json({ status: "retryable", retryable: true }, { status: 503 });
        }
      }
      if (prior?.status === "processing" && Date.now() - new Date(prior.updated_at).getTime() < 10 * 60 * 1000) {
        return NextResponse.json({ status: "already processing" });
      }
      if (!missingEventsTable) {
        const claimResult = await requireWhatsAppDb(prior
          ? db.from("whatsapp_events").update({ status: "processing", sender_phone: from, updated_at: new Date().toISOString() }).eq("message_id", messageId)
          : db.from("whatsapp_events").insert({ message_id: messageId, sender_phone: from, status: "processing" }));
        const { error: claimError } = claimResult;
        if (claimError?.code === "23505") return NextResponse.json({ status: "already processing" });
        if (claimError) throw claimError;
        eventTracked = true;
      }
    }
    const markEvent = async (status: "completed" | "failed") => {
      if (eventTracked && messageId) {
        const result = await boundedWhatsAppDb(db.from("whatsapp_events").update({ status, updated_at: new Date().toISOString() }).eq("message_id", messageId));
        if (result?.error) console.error("WhatsApp event status update failed:", result.error.message);
      }
    };
    markFailed = async () => {
      if (eventTracked && messageId) {
        await boundedWhatsAppDb(db.from("whatsapp_events")
          .update({ status: "failed", updated_at: new Date().toISOString() })
          .eq("message_id", messageId)
          .eq("status", "processing"));
      }
    };
    const firstFarmResult = await requireWhatsAppDb(db
      .from("farms")
      .select("id")
      .eq("owner_phone", `+${from}`)
      .single());
    let { data: farm } = firstFarmResult;

    if (!farm) {
      // Also try without +
      const { data: farm2 } = await requireWhatsAppDb(db
        .from("farms")
        .select("id")
        .eq("owner_phone", from)
        .single());
      farm = farm2;
    }

    if (!farm) {
      // Auto-create farm for new user
      const senderName = value?.contacts?.[0]?.profile?.name || "Mi Campo";
      const { data: newFarm, error: newFarmError } = await requireWhatsAppDb(db
        .from("farms")
        .insert({
          name: `Campo de ${senderName}`,
          owner_phone: `+${from}`,
        })
        .select()
        .single());
      if (newFarmError || !newFarm) throw new Error("Could not create WhatsApp farm");
      farm = newFarm;

      await sendWhatsAppMessage(
        from,
        `🐄 ¡Bienvenido a CampoAI!\n\nTu campo "${newFarm?.name}" fue creado. Ahora podés:\n\n` +
          `📍 *Crear secciones*: "Agregar potrero Norte de 50 hectáreas"\n` +
          `🐮 *Registrar hacienda*: "Tengo 30 vacas Angus en el potrero Norte"\n` +
          `🔄 *Mover ganado*: "Mové 10 terneros del Norte al Sur"\n` +
          `❓ *Consultar*: "¿Cuántas cabezas hay en total?"\n` +
          `🎤 *Audio*: Mandá un audio y lo transcribo automáticamente\n\n` +
          `¡Empezá contándome sobre tu campo!`
      );
      await markEvent("completed");
      return NextResponse.json({ status: "welcome sent" });
    }

    let textContent = "";
    let audioTranscription = "";

    if (msgType === "text") {
      textContent = message.text?.body || "";
    } else if (msgType === "audio") {
      // Download and transcribe audio
      try {
        const audioBuffer = await withTimeout(
          downloadWhatsAppMedia(message.audio.id),
          Math.min(WHATSAPP_MEDIA_TIMEOUT_MS, Math.max(1, remainingMs())),
          null,
        );
        if (!audioBuffer) throw new WhatsAppAIRequestTimeout();
        const transcription = await withTimeout(
          transcribeAudio(audioBuffer, Math.min(WHATSAPP_TRANSCRIPTION_TIMEOUT_MS, Math.max(1, remainingMs()))),
          Math.min(WHATSAPP_TRANSCRIPTION_TIMEOUT_MS, Math.max(1, remainingMs())),
          null,
        );
        if (!transcription) throw new WhatsAppAIRequestTimeout();
        audioTranscription = transcription;
        textContent = audioTranscription;

        // Acknowledge the transcription
        await sendWhatsAppMessage(
          from,
          `🎤 _Transcripción:_ "${audioTranscription}"\n\nProcesando...`
        );
      } catch (e) {
        console.error("Audio processing error:", e);
        await sendWhatsAppMessage(
          from,
          "No pude procesar el audio. Intentá mandarlo de nuevo o escribí un texto."
        );
        await markEvent("completed");
        return NextResponse.json({ status: "audio error" });
      }
    } else {
      await sendWhatsAppMessage(
        from,
        "Por ahora solo proceso mensajes de texto y audio. Mandame un texto o un audio con tu novedad."
      );
      await markEvent("completed");
      return NextResponse.json({ status: "unsupported type" });
    }

    if (!textContent.trim()) {
      await markEvent("completed");
      return NextResponse.json({ status: "empty message" });
    }

    // Process with AI
    let aiResult = await withTimeout(
      processMessage(
        farm.id,
        textContent,
        msgType === "audio" ? "audio" : "text",
        readSharedChatHistory(farm.id, WHATSAPP_CHAT_HISTORY_TIMEOUT_MS),
      ),
      Math.min(WHATSAPP_AI_TIMEOUT_MS, Math.max(1, remainingMs())),
      null,
    );
    if (!aiResult) throw new WhatsAppAIRequestTimeout();

    if (isBareAIConfirmation(textContent) && aiResult.dbOperations?.length) {
      aiResult = {
        intent: "help" as const,
        response: "Para aplicar una propuesta necesito el pedido original. Describime nuevamente el cambio que querés guardar y te muestro qué voy a registrar.",
        dbOperations: [],
      };
    }

    // Execute DB operations if any
    let operationErrors: string[] = [];
    if (aiResult.dbOperations && aiResult.dbOperations.length > 0) {
      const operationBudget = remainingMs() - WHATSAPP_OPERATION_RESERVE_MS;
      if (operationBudget < WHATSAPP_MIN_OPERATION_BUDGET_MS) throw new WhatsAppAIRequestTimeout();
      const logs = await executeOperations(farm.id, aiResult.dbOperations, operationBudget);
      console.log("DB operations:", logs);
      operationErrors = logs.filter((log) => log.startsWith("Error") || log.startsWith("Exception"));
    }
    const changeLabels = applyAIChangeFeedback(aiResult, aiResult.dbOperations, operationErrors).map((link) => link.label);
    if (changeLabels.length > 0) aiResult.response += `\n\n📌 Revisá: ${Array.from(new Set(changeLabels)).join(", ")}.`;

    // Keep the web Chat transcript in sync with WhatsApp. This is best effort:
    // the WhatsApp reply remains deliverable if an old deployment is missing
    // the chat table or Supabase briefly refuses this non-critical write.
    const chatPersist = await boundedWhatsAppDb(db
      .from("chat_messages")
      .insert([
        { farm_id: farm.id, role: "user", content: persistedChatUserMessage(textContent, msgType === "audio" ? "audio" : "text") },
        { farm_id: farm.id, role: "assistant", content: aiResult.response },
      ]), WHATSAPP_CHAT_HISTORY_TIMEOUT_MS);
    if (chatPersist?.error) {
      console.error("WhatsApp chat history write failed:", chatPersist.error.message);
    }

    if (eventTracked && eventRetrySafetyAvailable && messageId) {
      const { error: sideEffectsError } = await requireWhatsAppDb(db.from("whatsapp_events")
        .update({ status: "side_effects_done", response_text: aiResult.response, updated_at: new Date().toISOString() })
        .eq("message_id", messageId)
        .eq("status", "processing"));
      if (sideEffectsError) throw sideEffectsError;
    }

    // Send response back via WhatsApp
    const sent = await withTimeout(
      sendWhatsAppMessage(from, aiResult.response).then(() => true),
      Math.min(WHATSAPP_DB_TIMEOUT_MS, Math.max(1, remainingMs())),
      false,
    );
    if (!sent) throw new WhatsAppAIRequestTimeout();
    await markEvent("completed");

    return NextResponse.json({ status: "processed" });
  } catch (error) {
    console.error("Webhook error:", error);
    await markFailed?.();
    if (isAIFarmContextUnavailableError(error)) {
      return NextResponse.json({ status: "error", retryable: true, code: AI_CONTEXT_UNAVAILABLE_CODE }, { status: 503 });
    }
    if (error instanceof WhatsAppSupabaseTimeout) {
      return NextResponse.json(
        { status: "retryable", retryable: true, code: "whatsapp_supabase_timeout" },
        { status: 504 },
      );
    }
    if (error instanceof WhatsAppAIRequestTimeout) {
      return NextResponse.json(
        { status: "retryable", retryable: true, code: "whatsapp_ai_timeout" },
        { status: 504 },
      );
    }
    return NextResponse.json({ status: "error", retryable: true }, { status: 503 });
  }
}
