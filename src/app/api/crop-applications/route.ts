import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireFarm } from "@/lib/auth";

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

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const body = await req.json();
  const db = getSupabaseAdmin();
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

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const { id } = await req.json();
  const db = getSupabaseAdmin();
  const { error } = await db
    .from("crop_applications")
    .delete()
    .eq("id", id)
    .eq("farm_id", result.farmId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
