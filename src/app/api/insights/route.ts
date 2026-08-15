import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireFarm } from "@/lib/auth";
import { generateFarmSummary } from "@/lib/ai";
import { checkRateLimit } from "@/lib/rate-limit";
import { SUPABASE_READ_TIMEOUT_MS, withTimeout } from "@/lib/timeout";

export const maxDuration = 30;
const INSIGHT_RATE_LIMIT = { capacity: 2, refillPerSec: 1 / 300 };

async function regenerate(farmId: string) {
  const summary = await generateFarmSummary(farmId);
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("farm_insights")
    .upsert({ farm_id: farmId, summary, generated_at: new Date().toISOString() }, { onConflict: "farm_id" })
    .select("summary, generated_at")
    .single();
  if (error || !data) throw new Error("Insight persistence failed");
  return data;
}

// GET stays fast and cache-only. Generating an insight is an explicit action
// because the AI provider can take several seconds and should not block the
// first dashboard render.
export async function GET() {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const db = getSupabaseAdmin();
  const queryResult = await withTimeout(
    db
      .from("farm_insights")
      .select("summary, generated_at")
      .eq("farm_id", result.farmId)
      .single(),
    SUPABASE_READ_TIMEOUT_MS,
    null,
  );
  if (!queryResult) return NextResponse.json({ error: "El resumen tardó demasiado. Intentá nuevamente." }, { status: 504 });
  const { data: cached, error: cacheError } = queryResult;

  if (cacheError && cacheError.code !== "PGRST116") {
    console.error("Insight cache query failed:", cacheError.message);
    return NextResponse.json({ error: "No se pudo cargar el resumen." }, { status: 503 });
  }
  if (cached) return NextResponse.json(cached);
  return NextResponse.json({ summary: null, generated_at: null });
}

// POST: force-regenerate the summary.
export async function POST() {
  const result = await requireFarm();
  if ("error" in result) return result.error;
  const limit = checkRateLimit(`insights:${result.farmId}`, INSIGHT_RATE_LIMIT);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Se alcanzó el límite de actualizaciones del resumen. Esperá unos minutos e intentá de nuevo." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
    );
  }
  try {
    return NextResponse.json(await regenerate(result.farmId));
  } catch {
    return NextResponse.json({ error: "No se pudo generar el resumen." }, { status: 500 });
  }
}
