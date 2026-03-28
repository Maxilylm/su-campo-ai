import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getAuthFarmId } from "@/lib/auth";
import { processMessage, executeOperations } from "@/lib/ai";

export async function POST(req: NextRequest) {
  try {
    const farmId = await getAuthFarmId();
    if (!farmId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { message } = await req.json();
    if (!message) {
      return NextResponse.json(
        { error: "message required" },
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
