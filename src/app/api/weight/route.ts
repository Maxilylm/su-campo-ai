import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireFarm } from "@/lib/auth";
import { parseJsonBody } from "@/lib/request";
import { databaseFailure } from "@/lib/api-error";
import { isValidDateOnly } from "@/lib/date";
import { SUPABASE_READ_TIMEOUT_MS, withTimeout } from "@/lib/timeout";
import { parseIdempotencyKey } from "@/lib/idempotency";
import { splitPage } from "@/lib/pagination";

const MAX_WEIGHT_RECORDS = 500;

function weightWriteTimeout(action: string) {
  return NextResponse.json(
    { error: `Supabase tardó demasiado al ${action}. Intentá nuevamente.`, code: "weight_write_timeout" },
    { status: 504 },
  );
}

// GET ?cattleId= : weight history for a batch (ascending by date).
// GET ?recordId= : one record, used by audit deep-links to resolve its batch.
export async function GET(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const cattleId = req.nextUrl.searchParams.get("cattleId");
  const recordId = req.nextUrl.searchParams.get("recordId");
  if (recordId !== null && !recordId.trim()) return NextResponse.json({ error: "recordId inválido" }, { status: 400 });
  if (cattleId !== null && !cattleId.trim()) return NextResponse.json({ error: "cattleId inválido" }, { status: 400 });

  const db = getSupabaseAdmin();
  if (recordId) {
    const queryResult = await withTimeout(
      db
        .from("weight_records")
        .select("id, cattle_id, date, weight_kg, notes")
        .eq("id", recordId)
        .eq("farm_id", result.farmId)
        .maybeSingle(),
      SUPABASE_READ_TIMEOUT_MS,
      null,
    );
    if (!queryResult) {
      return NextResponse.json({ error: "El pesaje tardó demasiado. Intentá nuevamente." }, { status: 504 });
    }
    const { data, error } = queryResult;
    if (error) return databaseFailure("weight record lookup", error);
    if (!data) return NextResponse.json({ error: "Pesaje no encontrado" }, { status: 404 });
    return NextResponse.json(data);
  }

  let weightQuery = db
    .from("weight_records")
    .select("id, cattle_id, date, weight_kg, notes", { count: "exact" })
    .eq("farm_id", result.farmId)
    .order("date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(MAX_WEIGHT_RECORDS + 1);
  if (cattleId) weightQuery = weightQuery.eq("cattle_id", cattleId);
  const queryResult = await withTimeout(
    weightQuery,
    SUPABASE_READ_TIMEOUT_MS,
    null,
  );
  if (!queryResult) {
    return NextResponse.json({ error: "El historial de pesajes tardó demasiado. Intentá nuevamente." }, { status: 504 });
  }
  const { data, count, error } = queryResult;

  if (error) return databaseFailure("weight GET", error);
  const page = splitPage(data || [], MAX_WEIGHT_RECORDS);
  const response = NextResponse.json([...page.items].reverse());
  response.headers.set("X-CampoAI-Weight-Limit", String(MAX_WEIGHT_RECORDS));
  if (page.hasMore || (count ?? 0) > MAX_WEIGHT_RECORDS) response.headers.set("X-CampoAI-Weight-Truncated", "true");
  return response;
}

// POST: add a weighing; keep the batch's current weight in sync with the latest.
export async function POST(req: NextRequest) {
  const result = await requireFarm({ write: true });
  if ("error" in result) return result.error;

  const parsed = await parseJsonBody(req);
  if ("error" in parsed) return parsed.error;
  const body = parsed.data;
  const idempotencyKey = parseIdempotencyKey(req.headers.get("idempotency-key"));
  if (idempotencyKey === false) {
    return NextResponse.json({ error: "Idempotency-Key inválida" }, { status: 400 });
  }
  if (typeof body.cattleId !== "string" || !body.cattleId.trim() || body.weightKg == null) {
    return NextResponse.json({ error: "cattleId and weightKg required" }, { status: 400 });
  }
  const date = body.date || new Date().toISOString().slice(0, 10);
  const weightKg = Number(body.weightKg);
  if (!Number.isFinite(weightKg) || weightKg <= 0) {
    return NextResponse.json({ error: "weightKg must be a positive number" }, { status: 400 });
  }
  if (!isValidDateOnly(date)) {
    return NextResponse.json({ error: "date must use YYYY-MM-DD" }, { status: 400 });
  }
  const db = getSupabaseAdmin();

  if (idempotencyKey) {
    const existingLookup = await withTimeout(
      db
        .from("weight_records")
        .select("id, cattle_id, date, weight_kg, notes")
        .eq("farm_id", result.farmId)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle(),
      SUPABASE_READ_TIMEOUT_MS,
      null,
    );
    if (!existingLookup) return weightWriteTimeout("verificar el reintento del pesaje");
    const { data: existing, error: existingError } = existingLookup;
    // An older schema may not have the optional key column yet; the insert
    // below will return the actionable migration response in that case.
    if (existingError && !["PGRST204", "PGRST205"].includes(existingError.code || "")) {
      return databaseFailure("weight idempotency lookup", existingError);
    }
    if (existing) return NextResponse.json(existing);
  }

  // The referenced batch must belong to the caller's farm.
  const batchLookup = await withTimeout(
    db
      .from("cattle")
      .select("id")
      .eq("id", body.cattleId)
      .eq("farm_id", result.farmId)
      .single(),
    SUPABASE_READ_TIMEOUT_MS,
    null,
  );
  if (!batchLookup) return weightWriteTimeout("verificar el lote");
  const { data: batch, error: batchError } = batchLookup;
  if (batchError && batchError.code !== "PGRST116") return databaseFailure("weight cattle lookup", batchError);
  if (!batch) {
    return NextResponse.json({ error: "Lote no encontrado" }, { status: 404 });
  }

  const weightResult = await withTimeout(
    db.rpc("record_weight", {
      p_farm_id: result.farmId,
      p_cattle_id: body.cattleId,
      p_date: date,
      p_weight_kg: weightKg,
      p_notes: body.notes || null,
      ...(idempotencyKey ? { p_idempotency_key: idempotencyKey } : {}),
    }),
    SUPABASE_READ_TIMEOUT_MS,
    null,
  );
  if (!weightResult) return weightWriteTimeout("registrar el pesaje");
  const { data: recordId, error: rpcError } = weightResult;
  if (!rpcError && recordId) {
    const recordLookup = await withTimeout(
      db
        .from("weight_records")
        .select("id, date, weight_kg, notes")
        .eq("id", recordId)
        .eq("farm_id", result.farmId)
        .single(),
      SUPABASE_READ_TIMEOUT_MS,
      null,
    );
    if (!recordLookup) return weightWriteTimeout("confirmar el pesaje");
    const { data: record, error: recordError } = recordLookup;
    if (recordError) return NextResponse.json({ error: "Pesaje guardado pero no se pudo leer el registro." }, { status: 503 });
    return NextResponse.json(record);
  }
  if (rpcError && rpcError.code !== "PGRST202") {
    console.error("Transactional weight write failed:", rpcError.message);
    return NextResponse.json({ error: "No se pudo registrar el pesaje de forma segura." }, { status: 503 });
  }
  if (rpcError?.code === "PGRST202" && idempotencyKey) {
    return NextResponse.json({
      error: "Aplicá supabase/017_idempotency.sql para habilitar reintentos seguros de pesajes.",
      code: "idempotency_migration_required",
    }, { status: 503 });
  }

  const insertResult = await withTimeout(
    db
      .from("weight_records")
      .insert({
        farm_id: result.farmId,
        cattle_id: body.cattleId,
        date,
        weight_kg: weightKg,
        notes: body.notes || null,
        ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
      })
      .select()
      .single(),
    SUPABASE_READ_TIMEOUT_MS,
    null,
  );
  if (!insertResult) return weightWriteTimeout("guardar el pesaje");
  const { data, error } = insertResult;
  if (error?.code === "PGRST204" && idempotencyKey) {
    return NextResponse.json({
      error: "Aplicá supabase/017_idempotency.sql para habilitar reintentos seguros de pesajes.",
      code: "idempotency_migration_required",
    }, { status: 503 });
  }
  if (error?.code === "23505" && idempotencyKey) {
    const replayLookup = await withTimeout(
      db
        .from("weight_records")
        .select("id, date, weight_kg, notes")
        .eq("farm_id", result.farmId)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle(),
      SUPABASE_READ_TIMEOUT_MS,
      null,
    );
    if (!replayLookup) return weightWriteTimeout("resolver el reintento del pesaje");
    const { data: existing, error: existingError } = replayLookup;
    if (existingError) return databaseFailure("weight idempotency lookup", existingError);
    if (existing) return NextResponse.json(existing);
    return NextResponse.json({ error: "No se pudo resolver el reintento del pesaje." }, { status: 503 });
  }
  if (error) return databaseFailure("weight POST", error);

  // Sync the batch's current weight to the most recent weighing.
  const latestLookup = await withTimeout(
    db
      .from("weight_records")
      .select("weight_kg")
      .eq("cattle_id", body.cattleId)
      .eq("farm_id", result.farmId)
      .order("date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .single(),
    SUPABASE_READ_TIMEOUT_MS,
    null,
  );
  if (!latestLookup) return weightWriteTimeout("confirmar el último pesaje");
  const { data: latest, error: latestError } = latestLookup;
  if (latestError && latestError.code !== "PGRST116") return databaseFailure("weight latest lookup", latestError);
  if (latest) {
    const syncResult = await withTimeout(
      db.from("cattle").update({ weight_kg: latest.weight_kg }).eq("id", body.cattleId).eq("farm_id", result.farmId),
      SUPABASE_READ_TIMEOUT_MS,
      null,
    );
    if (!syncResult) return weightWriteTimeout("actualizar el peso del lote");
    const { error: syncError } = syncResult;
    if (syncError) {
      console.error("Failed to sync cattle weight:", syncError.message);
      return NextResponse.json({ error: "El pesaje se guardó, pero no se pudo actualizar el lote." }, { status: 503 });
    }
  }

  return NextResponse.json(data);
}
