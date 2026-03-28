import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { processMessage, executeOperations } from "@/lib/ai";

// Dashboard chat endpoint — same AI as WhatsApp but via HTTP
export async function POST(req: NextRequest) {
  try {
    const { farmId, message } = await req.json();

    if (!farmId || !message) {
      return NextResponse.json(
        { error: "farmId and message required" },
        { status: 400 }
      );
    }

    // Verify farm exists
    const db = getSupabaseAdmin();
    const { data: farm } = await db
      .from("farms")
      .select("id")
      .eq("id", farmId)
      .single();

    if (!farm) {
      return NextResponse.json({ error: "Farm not found" }, { status: 404 });
    }

    const aiResult = await processMessage(farmId, message, "text");

    if (aiResult.dbOperations && aiResult.dbOperations.length > 0) {
      await executeOperations(farmId, aiResult.dbOperations);
    }

    return NextResponse.json(aiResult);
  } catch (error) {
    console.error("Chat API error:", error);
    return NextResponse.json(
      { error: "Processing failed" },
      { status: 500 }
    );
  }
}
