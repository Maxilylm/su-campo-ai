import { NextRequest, NextResponse } from "next/server";
import { requireFarm } from "@/lib/auth";
import { processMessage, executeOperations } from "@/lib/ai";

export async function POST(req: NextRequest) {
  try {
    const result = await requireFarm();
    if ("error" in result) return result.error;

    const { message } = await req.json();
    if (!message) {
      return NextResponse.json({ error: "message required" }, { status: 400 });
    }

    const aiResult = await processMessage(result.farmId, message, "text");

    if (aiResult.dbOperations && aiResult.dbOperations.length > 0) {
      await executeOperations(result.farmId, aiResult.dbOperations);
    }

    return NextResponse.json(aiResult);
  } catch (error) {
    console.error("Chat API error:", error);
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
