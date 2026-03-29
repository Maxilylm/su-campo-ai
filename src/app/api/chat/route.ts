import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import { requireFarm } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { processMessage, executeOperations, ChatHistoryMessage } from "@/lib/ai";

// GET: load chat history
export async function GET() {
  try {
    const result = await requireFarm();
    if ("error" in result) return result.error;

    const db = getSupabaseAdmin();
    const { data, error } = await db
      .from("chat_messages")
      .select("role, content, created_at")
      .eq("farm_id", result.farmId)
      .order("created_at", { ascending: true })
      .limit(100);

    if (error) {
      // Table might not exist yet — return empty
      return NextResponse.json({ messages: [] });
    }

    return NextResponse.json({ messages: data || [] });
  } catch {
    return NextResponse.json({ messages: [] });
  }
}

// POST: send message + get AI response
export async function POST(req: NextRequest) {
  try {
    const result = await requireFarm();
    if ("error" in result) return result.error;

    const { message, history } = await req.json();
    if (!message) {
      return NextResponse.json({ error: "message required" }, { status: 400 });
    }

    // Convert history to AI format
    const chatHistory: ChatHistoryMessage[] = (history || []).map(
      (m: { role: string; text: string }) => ({
        role: m.role as "user" | "assistant",
        content: m.text,
      })
    );

    const aiResult = await processMessage(result.farmId, message, "text", chatHistory);

    let operationErrors: string[] = [];
    if (aiResult.dbOperations && aiResult.dbOperations.length > 0) {
      const logs = await executeOperations(result.farmId, aiResult.dbOperations);
      operationErrors = logs.filter((l) => l.startsWith("Error") || l.startsWith("Exception"));
      if (operationErrors.length > 0) {
        console.error("Chat DB operation errors:", operationErrors);
      }
    }

    if (operationErrors.length > 0) {
      aiResult.response += "\n\n⚠️ Algunos cambios no se guardaron correctamente. Intenta de nuevo.";
    }

    // Persist messages to DB (fire and forget — don't block the response)
    const db = getSupabaseAdmin();
    db.from("chat_messages").insert([
      { farm_id: result.farmId, role: "user", content: message },
      { farm_id: result.farmId, role: "assistant", content: aiResult.response },
    ]).then();

    return NextResponse.json(aiResult);
  } catch (error) {
    console.error("Chat API error:", error);
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}

// DELETE: clear chat history
export async function DELETE() {
  try {
    const result = await requireFarm();
    if ("error" in result) return result.error;

    const db = getSupabaseAdmin();
    await db
      .from("chat_messages")
      .delete()
      .eq("farm_id", result.farmId);

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Failed to clear history" }, { status: 500 });
  }
}
