import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireFarm } from "@/lib/auth";
import { parseJsonBody } from "@/lib/request";
import { databaseFailure } from "@/lib/api-error";
import { isValidDateOnly } from "@/lib/date";

const MAX_WEIGHT_RECORDS = 500;

// GET ?cattleId= : weight history for a batch (ascending by date).
// GET ?recordId= : one record, used by audit deep-links to resolve its batch.
export async function GET(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const cattleId = req.nextUrl.searchParams.get("cattleId");
  const recordId = req.nextUrl.searchParams.get("recordId");
  if (!cattleId && !recordId) return NextResponse.json({ error: "cattleId or recordId required" }, { status: 400 });
  if (recordId !== null && !recordId.trim()) return NextResponse.json({ error: "recordId inválido" }, { status: 400 });
  if (recordId === null && !cattleId?.trim()) return NextResponse.json({ error: "cattleId inválido" }, { status: 400 });

  const db = getSupabaseAdmin();
  if (recordId) {
    const { data, error } = await db
      .from("weight_records")
      .select("id, cattle_id, date, weight_kg, notes")
      .eq("id", recordId)
      .eq("farm_id", result.farmId)
      .maybeSingle();
    if (error) return databaseFailure("weight record lookup", error);
    if (!data) return NextResponse.json({ error: "Pesaje no encontrado" }, { status: 404 });
    return NextResponse.json(data);
  }

  const { data, error } = await db
    .from("weight_records")
    .select("id, date, weight_kg, notes")
    .eq("farm_id", result.farmId)
    .eq("cattle_id", cattleId)
    .order("date", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(MAX_WEIGHT_RECORDS);

  if (error) return databaseFailure("weight GET", error);
  return NextResponse.json(data || []);
}

// POST: add a weighing; keep the batch's current weight in sync with the latest.
export async function POST(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const parsed = await parseJsonBody(req);
  if ("error" in parsed) return parsed.error;
  const body = parsed.data;
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

  // The referenced batch must belong to the caller's farm.
  const { data: batch, error: batchError } = await db
    .from("cattle")
    .select("id")
    .eq("id", body.cattleId)
    .eq("farm_id", result.farmId)
    .single();
  if (batchError && batchError.code !== "PGRST116") return databaseFailure("weight cattle lookup", batchError);
  if (!batch) {
    return NextResponse.json({ error: "Lote no encontrado" }, { status: 404 });
  }

  const { data: recordId, error: rpcError } = await db.rpc("record_weight", {
    p_farm_id: result.farmId,
    p_cattle_id: body.cattleId,
    p_date: date,
    p_weight_kg: weightKg,
    p_notes: body.notes || null,
  });
  if (!rpcError && recordId) {
    const { data: record, error: recordError } = await db
      .from("weight_records")
      .select("id, date, weight_kg, notes")
      .eq("id", recordId)
      .eq("farm_id", result.farmId)
      .single();
    if (recordError) return NextResponse.json({ error: "Pesaje guardado pero no se pudo leer el registro." }, { status: 503 });
    return NextResponse.json(record);
  }
  if (rpcError && rpcError.code !== "PGRST202") {
    console.error("Transactional weight write failed:", rpcError.message);
    return NextResponse.json({ error: "No se pudo registrar el pesaje de forma segura." }, { status: 503 });
  }

  const { data, error } = await db
    .from("weight_records")
    .insert({
      farm_id: result.farmId,
      cattle_id: body.cattleId,
      date,
      weight_kg: weightKg,
      notes: body.notes || null,
    })
    .select()
    .single();
  if (error) return databaseFailure("weight POST", error);

  // Sync the batch's current weight to the most recent weighing.
  const { data: latest, error: latestError } = await db
    .from("weight_records")
    .select("weight_kg")
    .eq("cattle_id", body.cattleId)
    .eq("farm_id", result.farmId)
    .order("date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  if (latestError && latestError.code !== "PGRST116") return databaseFailure("weight latest lookup", latestError);
  if (latest) {
    const { error: syncError } = await db.from("cattle").update({ weight_kg: latest.weight_kg }).eq("id", body.cattleId).eq("farm_id", result.farmId);
    if (syncError) {
      console.error("Failed to sync cattle weight:", syncError.message);
      return NextResponse.json({ error: "El pesaje se guardó, pero no se pudo actualizar el lote." }, { status: 503 });
    }
  }

  return NextResponse.json(data);
}
