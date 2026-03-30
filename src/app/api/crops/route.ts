import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireFarm } from "@/lib/auth";

export async function GET() {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("crops")
    .select("*, sections(name), crop_applications(id)")
    .eq("farm_id", result.farmId)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const body = await req.json();
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("crops")
    .insert({
      farm_id: result.farmId,
      section_id: body.sectionId || null,
      crop_type: body.cropType || "soja",
      variety: body.variety || null,
      planted_hectares: body.plantedHectares || null,
      planting_date: body.plantingDate || null,
      expected_harvest: body.expectedHarvest || null,
      actual_harvest: body.actualHarvest || null,
      yield_kg: body.yieldKg || null,
      status: body.status || "planted",
      soil_type: body.soilType || null,
      irrigation_type: body.irrigationType || null,
      notes: body.notes || null,
    })
    .select("*, sections(name)")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function PUT(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const body = await req.json();
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("crops")
    .update({
      section_id: body.sectionId,
      crop_type: body.cropType,
      variety: body.variety,
      planted_hectares: body.plantedHectares,
      planting_date: body.plantingDate,
      expected_harvest: body.expectedHarvest,
      actual_harvest: body.actualHarvest,
      yield_kg: body.yieldKg,
      status: body.status,
      soil_type: body.soilType,
      irrigation_type: body.irrigationType,
      notes: body.notes,
      updated_at: new Date().toISOString(),
    })
    .eq("id", body.id)
    .eq("farm_id", result.farmId)
    .select("*, sections(name)")
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
    .from("crops")
    .delete()
    .eq("id", id)
    .eq("farm_id", result.farmId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
