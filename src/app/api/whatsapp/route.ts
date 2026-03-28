import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { sendWhatsAppMessage, downloadWhatsAppMedia } from "@/lib/whatsapp";
import { transcribeAudio, processMessage, executeOperations } from "@/lib/ai";

// WhatsApp webhook verification (GET)
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new Response(challenge, { status: 200 });
  }
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

// WhatsApp incoming message (POST)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

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
    let { data: farm } = await db
      .from("farms")
      .select("id")
      .eq("owner_phone", `+${from}`)
      .single();

    if (!farm) {
      // Also try without +
      const { data: farm2 } = await db
        .from("farms")
        .select("id")
        .eq("owner_phone", from)
        .single();
      farm = farm2;
    }

    if (!farm) {
      // Auto-create farm for new user
      const senderName = value?.contacts?.[0]?.profile?.name || "Mi Campo";
      const { data: newFarm } = await db
        .from("farms")
        .insert({
          name: `Campo de ${senderName}`,
          owner_phone: `+${from}`,
        })
        .select()
        .single();
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
      return NextResponse.json({ status: "welcome sent" });
    }

    let textContent = "";
    let audioTranscription = "";

    if (msgType === "text") {
      textContent = message.text?.body || "";
    } else if (msgType === "audio") {
      // Download and transcribe audio
      try {
        const audioBuffer = await downloadWhatsAppMedia(message.audio.id);
        audioTranscription = await transcribeAudio(audioBuffer);
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
        return NextResponse.json({ status: "audio error" });
      }
    } else {
      await sendWhatsAppMessage(
        from,
        "Por ahora solo proceso mensajes de texto y audio. Mandame un texto o un audio con tu novedad."
      );
      return NextResponse.json({ status: "unsupported type" });
    }

    if (!textContent.trim()) {
      return NextResponse.json({ status: "empty message" });
    }

    // Process with AI
    const aiResult = await processMessage(
      farm.id,
      textContent,
      msgType === "audio" ? "audio" : "text"
    );

    // Execute DB operations if any
    if (aiResult.dbOperations && aiResult.dbOperations.length > 0) {
      const logs = await executeOperations(farm.id, aiResult.dbOperations);
      console.log("DB operations:", logs);
    }

    // Send response back via WhatsApp
    await sendWhatsAppMessage(from, aiResult.response);

    return NextResponse.json({ status: "processed" });
  } catch (error) {
    console.error("Webhook error:", error);
    return NextResponse.json({ status: "error" }, { status: 200 }); // Always return 200 to WhatsApp
  }
}
