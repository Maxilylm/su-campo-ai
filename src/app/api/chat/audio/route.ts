import { NextRequest, NextResponse } from "next/server";
import { requireFarm } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { transcribeAudio, processMessage, executeOperations, ChatHistoryMessage } from "@/lib/ai";

export async function POST(req: NextRequest) {
  try {
    const result = await requireFarm();
    if ("error" in result) return result.error;

    const formData = await req.formData();
    const audioFile = formData.get("audio") as Blob | null;
    const historyRaw = formData.get("history") as string | null;

    if (!audioFile) {
      return NextResponse.json({ error: "audio required" }, { status: 400 });
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
      try {
        const parsed = JSON.parse(historyRaw);
        chatHistory = (parsed || []).map(
          (m: { role: string; text: string }) => ({
            role: m.role as "user" | "assistant",
            content: m.text,
          })
        );
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

    // Persist messages
    const db = getSupabaseAdmin();
    db.from("chat_messages").insert([
      { farm_id: result.farmId, role: "user", content: `🎤 ${transcription}` },
      { farm_id: result.farmId, role: "assistant", content: aiResult.response },
    ]).then();

    return NextResponse.json({ ...aiResult, transcription });
  } catch (error) {
    console.error("Audio chat error:", error);
    return NextResponse.json({ error: "Audio processing failed" }, { status: 500 });
  }
}
