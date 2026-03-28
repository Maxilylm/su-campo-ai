import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireFarm } from "@/lib/auth";

export async function GET() {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("cattle")
    .select("*, sections(name)")
    .eq("farm_id", result.farmId)
    .order("category");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const body = await req.json();
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("cattle")
    .insert({
      farm_id: result.farmId,
      section_id: body.sectionId || null,
      category: body.category || "vaca",
      breed: body.breed || null,
      count: body.count || 1,
      tag_range: body.tagRange || null,
      ear_tag: body.earTag || null,
      health_status: body.healthStatus || "healthy",
      weight_kg: body.weightKg || null,
      birth_date: body.birthDate || null,
      origin: body.origin || "propio",
      vaccination_status: body.vaccinationStatus || "pendiente",
      reproductive_status: body.reproductiveStatus || null,
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
    .from("cattle")
    .update({
      section_id: body.sectionId,
      category: body.category,
      breed: body.breed,
      count: body.count,
      tag_range: body.tagRange,
      ear_tag: body.earTag,
      health_status: body.healthStatus,
      weight_kg: body.weightKg,
      birth_date: body.birthDate,
      origin: body.origin,
      vaccination_status: body.vaccinationStatus,
      reproductive_status: body.reproductiveStatus,
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
    .from("cattle")
    .delete()
    .eq("id", id)
    .eq("farm_id", result.farmId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
