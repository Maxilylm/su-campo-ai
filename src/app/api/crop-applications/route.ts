import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireFarm } from "@/lib/auth";
import { parseJsonBody } from "@/lib/request";
import { databaseFailure } from "@/lib/api-error";
import { isValidDateOnly } from "@/lib/date";
import { SUPABASE_READ_TIMEOUT_MS, withTimeout } from "@/lib/timeout";

const MAX_CROP_APPLICATIONS = 500;
const APPLICATION_TYPES = new Set(["fertilizante", "herbicida", "insecticida", "fungicida"]);

export async function GET(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const db = getSupabaseAdmin();
  const cropId = req.nextUrl.searchParams.get("cropId");

  let query = db
    .from("crop_applications")
    .select("*")
    .eq("farm_id", result.farmId)
    .order("date_applied", { ascending: false, nullsFirst: false })
    .limit(MAX_CROP_APPLICATIONS);

  if (req.nextUrl.searchParams.has("cropId")) {
    if (!cropId?.trim()) return NextResponse.json({ error: "cropId inválido" }, { status: 400 });
    query = query.eq("crop_id", cropId);
  }

  const queryResult = await withTimeout(query, SUPABASE_READ_TIMEOUT_MS, null);
  if (!queryResult) return NextResponse.json({ error: "Las aplicaciones agrícolas tardaron demasiado. Intentá nuevamente." }, { status: 504 });
  const { data, error } = queryResult;

  if (error) return databaseFailure("crop applications GET", error);
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const parsed = await parseJsonBody(req);
  if ("error" in parsed) return parsed.error;
  const body = parsed.data;
  if (typeof body.cropId !== "string" || !body.cropId.trim()) return NextResponse.json({ error: "cropId requerido" }, { status: 400 });
  if (typeof body.type !== "string" || !APPLICATION_TYPES.has(body.type)) return NextResponse.json({ error: "type inválido" }, { status: 400 });
  if (body.dateApplied != null && body.dateApplied !== "" && !isValidDateOnly(body.dateApplied)) return NextResponse.json({ error: "Fecha de aplicación inválida" }, { status: 400 });
  const db = getSupabaseAdmin();

  // The referenced crop must belong to the caller's farm — an unchecked
  // cropId would let one farm attach applications to another farm's crop.
  const { data: crop, error: cropError } = await db
    .from("crops")
    .select("id")
    .eq("id", body.cropId)
    .eq("farm_id", result.farmId)
    .single();
  if (cropError && cropError.code !== "PGRST116") return databaseFailure("crop applications crop lookup", cropError);
  if (!crop) {
    return NextResponse.json({ error: "Cultivo no encontrado" }, { status: 404 });
  }

  const { data, error } = await db
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
    })
    .select()
    .single();

  if (error) return databaseFailure("crop applications POST", error);
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
    .from("crop_applications")
    .delete()
    .eq("id", id)
    .eq("farm_id", result.farmId)
    .select("id")
    .maybeSingle();

  if (error) return databaseFailure("crop applications DELETE", error);
  if (!deleted) return NextResponse.json({ error: "Aplicación no encontrada" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
