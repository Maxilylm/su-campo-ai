import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireFarm } from "@/lib/auth";
import { parseJsonBody } from "@/lib/request";
import { databaseFailure } from "@/lib/api-error";
import { isValidDateOnly } from "@/lib/date";
import { SUPABASE_READ_TIMEOUT_MS, withTimeout } from "@/lib/timeout";
import { parseIdempotencyKey } from "@/lib/idempotency";
import { splitPage } from "@/lib/pagination";

const MAX_CROP_APPLICATIONS = 500;
const APPLICATION_TYPES = new Set(["fertilizante", "herbicida", "insecticida", "fungicida"]);

function cropApplicationWriteTimeout(action: string) {
  return NextResponse.json(
    { error: `Supabase tardó demasiado al ${action}. Intentá nuevamente.`, code: "crop_application_write_timeout" },
    { status: 504 },
  );
}

export async function GET(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const db = getSupabaseAdmin();
  const cropId = req.nextUrl.searchParams.get("cropId");

  let query = db
    .from("crop_applications")
    .select("*", { count: "exact" })
    .eq("farm_id", result.farmId)
    .order("date_applied", { ascending: false, nullsFirst: false })
    .limit(MAX_CROP_APPLICATIONS + 1);

  if (req.nextUrl.searchParams.has("cropId")) {
    if (!cropId?.trim()) return NextResponse.json({ error: "cropId inválido" }, { status: 400 });
    query = query.eq("crop_id", cropId);
  }

  const queryResult = await withTimeout(query, SUPABASE_READ_TIMEOUT_MS, null);
  if (!queryResult) return NextResponse.json({ error: "Las aplicaciones agrícolas tardaron demasiado. Intentá nuevamente." }, { status: 504 });
  const { data, count, error } = queryResult;

  if (error) return databaseFailure("crop applications GET", error);
  const page = splitPage(data || [], MAX_CROP_APPLICATIONS);
  const response = NextResponse.json(page.items);
  response.headers.set("X-CampoAI-Crop-Applications-Limit", String(MAX_CROP_APPLICATIONS));
  if (page.hasMore || (count ?? 0) > MAX_CROP_APPLICATIONS) response.headers.set("X-CampoAI-Crop-Applications-Truncated", "true");
  return response;
}

export async function POST(req: NextRequest) {
  const result = await requireFarm({ write: true });
  if ("error" in result) return result.error;

  const parsed = await parseJsonBody(req);
  if ("error" in parsed) return parsed.error;
  const body = parsed.data;
  const idempotencyKey = parseIdempotencyKey(req.headers.get("idempotency-key"));
  if (idempotencyKey === false) return NextResponse.json({ error: "Idempotency-Key inválida" }, { status: 400 });
  if (typeof body.cropId !== "string" || !body.cropId.trim()) return NextResponse.json({ error: "cropId requerido" }, { status: 400 });
  if (typeof body.type !== "string" || !APPLICATION_TYPES.has(body.type)) return NextResponse.json({ error: "type inválido" }, { status: 400 });
  if (body.dateApplied != null && body.dateApplied !== "" && !isValidDateOnly(body.dateApplied)) return NextResponse.json({ error: "Fecha de aplicación inválida" }, { status: 400 });
  const db = getSupabaseAdmin();

  // The referenced crop must belong to the caller's farm — an unchecked
  // cropId would let one farm attach applications to another farm's crop.
  const cropLookup = await withTimeout(
    db
      .from("crops")
      .select("id")
      .eq("id", body.cropId)
      .eq("farm_id", result.farmId)
      .single(),
    SUPABASE_READ_TIMEOUT_MS,
    null,
  );
  if (!cropLookup) return cropApplicationWriteTimeout("verificar el cultivo");
  const { data: crop, error: cropError } = cropLookup;
  if (cropError && cropError.code !== "PGRST116") return databaseFailure("crop applications crop lookup", cropError);
  if (!crop) {
    return NextResponse.json({ error: "Cultivo no encontrado" }, { status: 404 });
  }

  if (idempotencyKey) {
    const existingLookup = await withTimeout(
      db.from("crop_applications").select("*").eq("farm_id", result.farmId).eq("idempotency_key", idempotencyKey).maybeSingle(),
      SUPABASE_READ_TIMEOUT_MS,
      null,
    );
    if (!existingLookup) return NextResponse.json({ error: "Agricultura tardó demasiado al verificar el reintento." }, { status: 504 });
    if (existingLookup.error?.code === "PGRST204" || existingLookup.error?.code === "PGRST205") return NextResponse.json({
      error: "Aplicá la migración 024 para habilitar reintentos seguros de Agricultura y Sanidad.",
      code: "operational_idempotency_migration_required",
      migration: "supabase/024_operational_idempotency.sql",
    }, { status: 503 });
    if (existingLookup.error) return databaseFailure("crop applications idempotency lookup", existingLookup.error);
    if (existingLookup.data) return NextResponse.json(existingLookup.data);
  }

  const insertResult = await withTimeout(
    db
      .from("crop_applications")
      .insert({
        farm_id: result.farmId,
        crop_id: body.cropId,
        type: body.type || "fertilizante",
        product_name: body.productName || null,
        dose_per_hectare: body.dosePerHectare || null,
        total_applied: body.totalApplied || null,
        date_applied: body.dateApplied || null,
        applied_by: body.appliedBy || null,
        weather_conditions: body.weatherConditions || null,
        notes: body.notes || null,
        ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
      })
      .select()
      .single(),
    SUPABASE_READ_TIMEOUT_MS,
    null,
  );
  if (!insertResult) return cropApplicationWriteTimeout("registrar la aplicación agrícola");
  const { data, error } = insertResult;

  if (error?.code === "PGRST204" && idempotencyKey) return NextResponse.json({
    error: "Aplicá la migración 024 para habilitar reintentos seguros de Agricultura y Sanidad.",
    code: "operational_idempotency_migration_required",
    migration: "supabase/024_operational_idempotency.sql",
  }, { status: 503 });
  if (error?.code === "23505" && idempotencyKey) {
    const replay = await withTimeout(
      db.from("crop_applications").select("*").eq("farm_id", result.farmId).eq("idempotency_key", idempotencyKey).maybeSingle(),
      SUPABASE_READ_TIMEOUT_MS,
      null,
    );
    if (!replay) return NextResponse.json({ error: "Agricultura tardó demasiado al resolver el reintento." }, { status: 504 });
    if (replay.error) return databaseFailure("crop applications idempotency replay", replay.error);
    if (replay.data) return NextResponse.json(replay.data);
  }
  if (error) return databaseFailure("crop applications POST", error);
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest) {
  const result = await requireFarm({ write: true });
  if ("error" in result) return result.error;

  const parsed = await parseJsonBody(req);
  if ("error" in parsed) return parsed.error;
  const { id } = parsed.data;
  if (typeof id !== "string" || !id) return NextResponse.json({ error: "id requerido" }, { status: 400 });
  const db = getSupabaseAdmin();
  const deleteResult = await withTimeout(
    db
      .from("crop_applications")
      .delete()
      .eq("id", id)
      .eq("farm_id", result.farmId)
      .select("id")
      .maybeSingle(),
    SUPABASE_READ_TIMEOUT_MS,
    null,
  );
  if (!deleteResult) return cropApplicationWriteTimeout("eliminar la aplicación agrícola");
  const { data: deleted, error } = deleteResult;

  if (error) return databaseFailure("crop applications DELETE", error);
  if (!deleted) return NextResponse.json({ error: "Aplicación no encontrada" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
