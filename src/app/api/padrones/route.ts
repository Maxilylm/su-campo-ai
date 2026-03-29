import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireFarm } from "@/lib/auth";

// GET: list saved padrones
export async function GET() {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("padrones")
    .select("*, sections(id, name, color, map_center)")
    .eq("farm_id", result.farmId)
    .order("padron_code");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// POST: save a padron from SNIG search
export async function POST(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const body = await req.json();
  const db = getSupabaseAdmin();

  // Insert padron
  const { data: padron, error: padronErr } = await db
    .from("padrones")
    .insert({
      farm_id: result.farmId,
      padron_code: body.padronCode,
      padron_number: body.padronNumber,
      department_code: body.departmentCode,
      department_name: body.departmentName,
      area_m2: body.areaM2 || null,
      geometry: body.geometry,
    })
    .select()
    .single();

  if (padronErr) return NextResponse.json({ error: padronErr.message }, { status: 500 });

  // Auto-create a section linked to this padron
  const { data: section, error: secErr } = await db
    .from("sections")
    .insert({
      farm_id: result.farmId,
      padron_id: padron.id,
      name: body.padronCode,
      size_hectares: body.areaM2 ? Math.round(body.areaM2 / 10000 * 10) / 10 : null,
      color: "#22c55e",
      water_status: "bueno",
      pasture_status: "bueno",
    })
    .select()
    .single();

  if (secErr) {
    console.error("Section creation error:", secErr);
  }

  return NextResponse.json({ padron, section });
}

// POST subsection: create a sub-section for a padron
export async function PUT(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const body = await req.json();
  const db = getSupabaseAdmin();

  // Create a sub-section linked to the padron
  const { data, error } = await db
    .from("sections")
    .insert({
      farm_id: result.farmId,
      padron_id: body.padronId,
      name: body.name,
      size_hectares: body.sizeHectares || null,
      color: body.color || "#22c55e",
      map_center: body.mapCenter || null,
      water_status: "bueno",
      pasture_status: "bueno",
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// DELETE: remove a padron and its linked sections
export async function DELETE(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const { id } = await req.json();
  const db = getSupabaseAdmin();

  // Unlink sections first (set padron_id to null)
  await db.from("sections").update({ padron_id: null }).eq("padron_id", id).eq("farm_id", result.farmId);

  const { error } = await db.from("padrones").delete().eq("id", id).eq("farm_id", result.farmId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
