import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireFarm } from "@/lib/auth";
import { generateFarmSummary } from "@/lib/ai";
import { checkRateLimit } from "@/lib/rate-limit";
import { SUPABASE_READ_TIMEOUT_MS, withTimeout } from "@/lib/timeout";
import { AI_CONTEXT_UNAVAILABLE_CODE, AI_CONTEXT_UNAVAILABLE_MESSAGE, isAIFarmContextUnavailableError } from "@/lib/ai-errors";

export const maxDuration = 30;
const INSIGHT_RATE_LIMIT = { capacity: 2, refillPerSec: 1 / 300 };
// requireFarm runs before regeneration and can take up to 5.5s on a degraded
// Supabase connection. Keep the remaining work bounded so the 30s platform
// limit is never the first timeout the caller sees.
const INSIGHT_TOTAL_TIMEOUT_MS = 21_000;

async function regenerate(farmId: string) {
  const summary = await generateFarmSummary(farmId);
  const db = getSupabaseAdmin();
  const persistenceResult = await withTimeout(
    db
      .from("farm_insights")
      .upsert({ farm_id: farmId, summary, generated_at: new Date().toISOString() }, { onConflict: "farm_id" })
      .select("summary, generated_at")
      .single(),
    SUPABASE_READ_TIMEOUT_MS,
    null,
  );
  if (!persistenceResult) {
    const timeout = new Error("Insight persistence timed out");
    timeout.name = "InsightPersistenceTimeout";
    throw timeout;
  }
  const { data, error } = persistenceResult;
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

// POST: force-regenerate the derived summary. This does not mutate operational
// farm data, so viewers may request it as an AI read operation.
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
    const regenerated = await withTimeout(
      regenerate(result.farmId),
      INSIGHT_TOTAL_TIMEOUT_MS,
      null,
    );
    if (!regenerated) {
      return NextResponse.json({ error: "Generar el resumen tardó demasiado. Intentá nuevamente.", code: "insight_timeout" }, { status: 504 });
    }
    return NextResponse.json(regenerated);
  } catch (error) {
    if (isAIFarmContextUnavailableError(error)) {
      return NextResponse.json({ error: AI_CONTEXT_UNAVAILABLE_MESSAGE, code: AI_CONTEXT_UNAVAILABLE_CODE }, { status: 503 });
    }
    if (error instanceof Error && error.name === "AbortError") {
      return NextResponse.json({ error: "Generar el resumen tardó demasiado. Intentá nuevamente.", code: "insight_timeout" }, { status: 504 });
    }
    if (error instanceof Error && error.name === "InsightPersistenceTimeout") {
      return NextResponse.json({ error: "Guardar el resumen tardó demasiado. Intentá nuevamente.", code: "insight_persist_timeout" }, { status: 504 });
    }
    return NextResponse.json({ error: "No se pudo generar el resumen." }, { status: 500 });
  }
}
