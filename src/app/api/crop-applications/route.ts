import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireFarm } from "@/lib/auth";
import { parseJsonBody } from "@/lib/request";
import { databaseFailure } from "@/lib/api-error";

export async function GET(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const db = getSupabaseAdmin();
  const cropId = req.nextUrl.searchParams.get("cropId");

  let query = db
    .from("crop_applications")
    .select("*")
    .eq("farm_id", result.farmId)
    .order("date_applied", { ascending: false });

  if (cropId) {
    query = query.eq("crop_id", cropId);
  }

  const { data, error } = await query;

  if (error) return databaseFailure("crop applications GET", error);
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const parsed = await parseJsonBody(req);
  if ("error" in parsed) return parsed.error;
  const body = parsed.data;
  const db = getSupabaseAdmin();

  // The referenced crop must belong to the caller's farm — an unchecked
  // cropId would let one farm attach applications to another farm's crop.
  const { data: crop } = await db
    .from("crops")
    .select("id")
    .eq("id", body.cropId)
    .eq("farm_id", result.farmId)
    .single();
  if (!crop) {
    return NextResponse.json({ error: "Cultivo no encontrado" }, { status: 404 });
  }

  const applicationTypes = new Set(["fertilizante", "herbicida", "insecticida", "fungicida"]);
  if (typeof body.type !== "string" || !applicationTypes.has(body.type)) return NextResponse.json({ error: "type inválido" }, { status: 400 });

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
  const db = getSupabaseAdmin();
  const { error } = await db
    .from("crop_applications")
    .delete()
    .eq("id", id)
    .eq("farm_id", result.farmId);

  if (error) return databaseFailure("crop applications DELETE", error);
  return NextResponse.json({ ok: true });
}
