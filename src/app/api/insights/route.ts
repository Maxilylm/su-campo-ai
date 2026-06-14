import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireFarm } from "@/lib/auth";
import { generateFarmSummary } from "@/lib/ai";

export const maxDuration = 30;

async function regenerate(farmId: string) {
  const summary = await generateFarmSummary(farmId);
  const db = getSupabaseAdmin();
  const { data } = await db
    .from("farm_insights")
    .upsert({ farm_id: farmId, summary, generated_at: new Date().toISOString() }, { onConflict: "farm_id" })
    .select("summary, generated_at")
    .single();
  return data;
}

// GET: return cached summary, generating one if none exists yet.
export async function GET() {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const db = getSupabaseAdmin();
  const { data: cached } = await db
    .from("farm_insights")
    .select("summary, generated_at")
    .eq("farm_id", result.farmId)
    .single();

  if (cached) return NextResponse.json(cached);

  try {
    return NextResponse.json(await regenerate(result.farmId));
  } catch {
    return NextResponse.json({ summary: null, generated_at: null });
  }
}

// POST: force-regenerate the summary.
export async function POST() {
  const result = await requireFarm();
  if ("error" in result) return result.error;
  try {
    return NextResponse.json(await regenerate(result.farmId));
  } catch {
    return NextResponse.json({ error: "No se pudo generar el resumen." }, { status: 500 });
  }
}
