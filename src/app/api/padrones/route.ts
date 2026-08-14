import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireFarm } from "@/lib/auth";
import { parseJsonBody } from "@/lib/request";
import { databaseFailure } from "@/lib/api-error";

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

  if (error) return databaseFailure("padrones GET", error);
  return NextResponse.json(data);
}

// POST: save a padron from SNIG search
export async function POST(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const parsed = await parseJsonBody(req);
  if ("error" in parsed) return parsed.error;
  const body = parsed.data;
  const db = getSupabaseAdmin();
  const padronCode = typeof body.padronCode === "string" ? body.padronCode.toUpperCase().trim() : "";
  const padronNumber = Number(body.padronNumber);
  const areaM2 = body.areaM2 == null || body.areaM2 === "" ? null : Number(body.areaM2);
  if (!/^[A-Z0-9]{1,8}-[A-Z0-9]{1,24}$/.test(padronCode)) return NextResponse.json({ error: "padronCode inválido" }, { status: 400 });
  if (!Number.isInteger(padronNumber) || padronNumber < 0) return NextResponse.json({ error: "padronNumber inválido" }, { status: 400 });
  if (areaM2 !== null && (!Number.isFinite(areaM2) || areaM2 <= 0)) return NextResponse.json({ error: "areaM2 inválida" }, { status: 400 });
  if (!body.geometry || typeof body.geometry !== "object" || Array.isArray(body.geometry) || typeof (body.geometry as { type?: unknown }).type !== "string" || !("coordinates" in body.geometry)) return NextResponse.json({ error: "geometry GeoJSON inválida" }, { status: 400 });
  if (JSON.stringify(body.geometry).length > 500_000) return NextResponse.json({ error: "geometry demasiado grande" }, { status: 413 });

  // Insert padron
  const { data: padron, error: padronErr } = await db
    .from("padrones")
    .insert({
      farm_id: result.farmId,
      padron_code: padronCode,
      padron_number: padronNumber,
      department_code: body.departmentCode,
      department_name: body.departmentName,
      area_m2: areaM2,
      geometry: body.geometry,
    })
    .select()
    .single();

  if (padronErr) return databaseFailure("padrones POST", padronErr);

  // Auto-create a section linked to this padron
  const { data: section, error: secErr } = await db
    .from("sections")
    .insert({
      farm_id: result.farmId,
      padron_id: padron.id,
      name: padronCode,
      size_hectares: areaM2 ? Math.round(areaM2 / 10000 * 10) / 10 : null,
      color: "#22c55e",
      water_status: "bueno",
      pasture_status: "bueno",
    })
    .select()
    .single();

  if (secErr) {
    console.error("Section creation error:", secErr);
    await db.from("padrones").delete().eq("id", padron.id).eq("farm_id", result.farmId);
    return NextResponse.json({ error: "No se pudo crear la sección del padrón." }, { status: 500 });
  }

  return NextResponse.json({ padron, section });
}

// POST subsection: create a sub-section for a padron
export async function PUT(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const parsed = await parseJsonBody(req);
  if ("error" in parsed) return parsed.error;
  const body = parsed.data;
  const db = getSupabaseAdmin();
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const sizeHectares = body.sizeHectares == null || body.sizeHectares === "" ? null : Number(body.sizeHectares);
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  if (sizeHectares !== null && (!Number.isFinite(sizeHectares) || sizeHectares <= 0)) return NextResponse.json({ error: "sizeHectares inválido" }, { status: 400 });

  // The referenced padron must belong to the caller's farm.
  const { data: padron } = await db
    .from("padrones")
    .select("id")
    .eq("id", body.padronId)
    .eq("farm_id", result.farmId)
    .single();
  if (!padron) {
    return NextResponse.json({ error: "Padron no encontrado" }, { status: 404 });
  }

  // Create a sub-section linked to the padron
  const { data, error } = await db
    .from("sections")
    .insert({
      farm_id: result.farmId,
      padron_id: body.padronId,
      name,
      size_hectares: sizeHectares,
      color: body.color || "#22c55e",
      map_center: body.mapCenter || null,
      water_status: "bueno",
      pasture_status: "bueno",
    })
    .select()
    .single();

  if (error) return databaseFailure("padrones PUT", error);
  return NextResponse.json(data);
}

// DELETE: remove a padron and its linked sections
export async function DELETE(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const parsed = await parseJsonBody(req);
  if ("error" in parsed) return parsed.error;
  const { id } = parsed.data;
  const db = getSupabaseAdmin();

  // Unlink sections first (set padron_id to null)
  await db.from("sections").update({ padron_id: null }).eq("padron_id", id).eq("farm_id", result.farmId);

  const { error } = await db.from("padrones").delete().eq("id", id).eq("farm_id", result.farmId);
  if (error) return databaseFailure("padrones DELETE", error);
  return NextResponse.json({ ok: true });
}
