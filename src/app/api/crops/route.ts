import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { farmRelationError, requireFarm, validateFarmRelations } from "@/lib/auth";
import { parseJsonBody } from "@/lib/request";
import { databaseFailure } from "@/lib/api-error";
import { isValidDateOnly } from "@/lib/date";
import { SUPABASE_READ_TIMEOUT_MS, withTimeout } from "@/lib/timeout";
import { splitPage } from "@/lib/pagination";
import { parseIdempotencyKey } from "@/lib/idempotency";

const MAX_CROP_RESPONSE = 500;

function operationalIdempotencyMigrationRequired() {
  return NextResponse.json({
    error: "Aplicá la migración 024 para habilitar reintentos seguros de Agricultura y Sanidad.",
    code: "operational_idempotency_migration_required",
    migration: "supabase/024_operational_idempotency.sql",
  }, { status: 503 });
}

export async function GET() {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const db = getSupabaseAdmin();
  const queryResult = await withTimeout(db
    .from("crops")
    .select("*, sections(name), crop_applications(id, type, product_name, dose_per_hectare, total_applied, date_applied, applied_by, weather_conditions, notes, created_at)", { count: "exact" })
    .eq("farm_id", result.farmId)
    .order("created_at", { ascending: false })
    .limit(MAX_CROP_RESPONSE + 1), SUPABASE_READ_TIMEOUT_MS, null);
  if (!queryResult) return NextResponse.json({ error: "Agricultura tardó demasiado. Intentá nuevamente." }, { status: 504 });
  const { data, count, error } = queryResult;

  if (error) return databaseFailure("crops GET", error);
  const page = splitPage(data || [], MAX_CROP_RESPONSE);
  const response = NextResponse.json(page.items);
  response.headers.set("X-CampoAI-Crops-Limit", String(MAX_CROP_RESPONSE));
  if (page.hasMore || (count ?? 0) > MAX_CROP_RESPONSE) response.headers.set("X-CampoAI-Crops-Truncated", "true");
  return response;
}

export async function POST(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const parsed = await parseJsonBody(req);
  if ("error" in parsed) return parsed.error;
  const body = parsed.data;
  const idempotencyKey = parseIdempotencyKey(req.headers.get("idempotency-key"));
  if (idempotencyKey === false) return NextResponse.json({ error: "Idempotency-Key inválida" }, { status: 400 });
  const relationCheck = await validateFarmRelations(result.farmId, [
    { table: "sections", id: body.sectionId },
  ]);
  if (!relationCheck.ok) return farmRelationError(relationCheck);

  const plantedHectares = body.plantedHectares == null || body.plantedHectares === "" ? null : Number(body.plantedHectares);
  const yieldKg = body.yieldKg == null || body.yieldKg === "" ? null : Number(body.yieldKg);
  const statuses = new Set(["planted", "growing", "harvested", "failed"]);
  if ([body.plantingDate, body.expectedHarvest, body.actualHarvest].some((value) => value != null && value !== "" && !isValidDateOnly(value))) return NextResponse.json({ error: "Fecha de cultivo inválida" }, { status: 400 });
  if (plantedHectares !== null && (!Number.isFinite(plantedHectares) || plantedHectares <= 0)) return NextResponse.json({ error: "plantedHectares must be positive" }, { status: 400 });
  if (yieldKg !== null && (!Number.isFinite(yieldKg) || yieldKg < 0)) return NextResponse.json({ error: "yieldKg must be non-negative" }, { status: 400 });
  if (body.status != null && !statuses.has(String(body.status))) return NextResponse.json({ error: "status inválido" }, { status: 400 });

  const db = getSupabaseAdmin();
  if (idempotencyKey) {
    const existingLookup = await withTimeout(
      db.from("crops").select("*, sections(name)").eq("farm_id", result.farmId).eq("idempotency_key", idempotencyKey).maybeSingle(),
      SUPABASE_READ_TIMEOUT_MS,
      null,
    );
    if (!existingLookup) return NextResponse.json({ error: "Agricultura tardó demasiado al verificar el reintento." }, { status: 504 });
    if (existingLookup.error?.code === "PGRST204" || existingLookup.error?.code === "PGRST205") return operationalIdempotencyMigrationRequired();
    if (existingLookup.error) return databaseFailure("crops idempotency lookup", existingLookup.error);
    if (existingLookup.data) return NextResponse.json(existingLookup.data);
  }
  const { data, error } = await db
    .from("crops")
    .insert({
      farm_id: result.farmId,
      section_id: body.sectionId || null,
      crop_type: body.cropType || "soja",
      variety: body.variety || null,
      planted_hectares: plantedHectares,
      planting_date: body.plantingDate || null,
      expected_harvest: body.expectedHarvest || null,
      actual_harvest: body.actualHarvest || null,
      yield_kg: yieldKg,
      status: body.status || "planted",
      soil_type: body.soilType || null,
      irrigation_type: body.irrigationType || null,
      notes: body.notes || null,
      ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
    })
    .select("*, sections(name)")
    .single();

  if (error?.code === "PGRST204" && idempotencyKey) return operationalIdempotencyMigrationRequired();
  if (error?.code === "23505" && idempotencyKey) {
    const replay = await withTimeout(
      db.from("crops").select("*, sections(name)").eq("farm_id", result.farmId).eq("idempotency_key", idempotencyKey).maybeSingle(),
      SUPABASE_READ_TIMEOUT_MS,
      null,
    );
    if (!replay) return NextResponse.json({ error: "Agricultura tardó demasiado al resolver el reintento." }, { status: 504 });
    if (replay.error) return databaseFailure("crops idempotency replay", replay.error);
    if (replay.data) return NextResponse.json(replay.data);
  }
  if (error) return databaseFailure("crops POST", error);
  return NextResponse.json(data);
}

export async function PUT(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const parsed = await parseJsonBody(req);
  if ("error" in parsed) return parsed.error;
  const body = parsed.data;
  if (typeof body.id !== "string" || !body.id) return NextResponse.json({ error: "id required" }, { status: 400 });

  if (Object.prototype.hasOwnProperty.call(body, "sectionId")) {
    const relationCheck = await validateFarmRelations(result.farmId, [
      { table: "sections", id: body.sectionId },
    ]);
    if (!relationCheck.ok) return farmRelationError(relationCheck);
  }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const fields: [string, string][] = [
    ["sectionId", "section_id"],
    ["cropType", "crop_type"],
    ["variety", "variety"],
    ["plantingDate", "planting_date"],
    ["expectedHarvest", "expected_harvest"],
    ["actualHarvest", "actual_harvest"],
    ["soilType", "soil_type"],
    ["irrigationType", "irrigation_type"],
    ["notes", "notes"],
  ];
  for (const [input, column] of fields) {
    if (Object.prototype.hasOwnProperty.call(body, input)) update[column] = body[input];
  }

  if ([body.plantingDate, body.expectedHarvest, body.actualHarvest].some((value) => value != null && value !== "" && !isValidDateOnly(value))) return NextResponse.json({ error: "Fecha de cultivo inválida" }, { status: 400 });

  if (Object.prototype.hasOwnProperty.call(body, "plantedHectares")) {
    const plantedHectares = body.plantedHectares == null || body.plantedHectares === "" ? null : Number(body.plantedHectares);
    if (plantedHectares !== null && (!Number.isFinite(plantedHectares) || plantedHectares <= 0)) return NextResponse.json({ error: "plantedHectares must be positive" }, { status: 400 });
    update.planted_hectares = plantedHectares;
  }
  if (Object.prototype.hasOwnProperty.call(body, "yieldKg")) {
    const yieldKg = body.yieldKg == null || body.yieldKg === "" ? null : Number(body.yieldKg);
    if (yieldKg !== null && (!Number.isFinite(yieldKg) || yieldKg < 0)) return NextResponse.json({ error: "yieldKg must be non-negative" }, { status: 400 });
    update.yield_kg = yieldKg;
  }
  if (Object.prototype.hasOwnProperty.call(body, "status")) {
    const statuses = new Set(["planted", "growing", "harvested", "failed"]);
    if (!statuses.has(String(body.status))) return NextResponse.json({ error: "status inválido" }, { status: 400 });
    update.status = body.status;
  }
  if (Object.keys(update).length === 1) return NextResponse.json({ error: "No hay cambios para guardar" }, { status: 400 });

  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("crops")
    .update(update)
    .eq("id", body.id)
    .eq("farm_id", result.farmId)
    .select("*, sections(name)")
    .single();

  if (error) return databaseFailure("crops PUT", error);
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const parsed = await parseJsonBody(req);
  if ("error" in parsed) return parsed.error;
  const { id } = parsed.data;
  if (typeof id !== "string" || !id) return NextResponse.json({ error: "id requerido" }, { status: 400 });
  const db = getSupabaseAdmin();
  const { data: deleted, error } = await db
    .from("crops")
    .delete()
    .eq("id", id)
    .eq("farm_id", result.farmId)
    .select("id")
    .maybeSingle();

  if (error) return databaseFailure("crops DELETE", error);
  if (!deleted) return NextResponse.json({ error: "Cultivo no encontrado" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
