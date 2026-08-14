import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireFarm } from "@/lib/auth";
import { parseJsonBody } from "@/lib/request";
import { databaseFailure } from "@/lib/api-error";

export async function GET() {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("sections")
    .select("*, cattle(id, section_id, category, count, breed, health_status, notes, weight_kg, vaccination_status, reproductive_status, ear_tag, tag_range, origin), padrones(id, padron_code, department_name)")
    .eq("farm_id", result.farmId)
    .order("name")
    .limit(500);

  if (error) return databaseFailure("sections GET", error);
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const parsed = await parseJsonBody(req);
  if ("error" in parsed) return parsed.error;
  const body = parsed.data;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const sizeHectares = body.sizeHectares == null || body.sizeHectares === "" ? null : Number(body.sizeHectares);
  const capacity = body.capacity == null || body.capacity === "" ? null : Number(body.capacity);
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  if (sizeHectares !== null && (!Number.isFinite(sizeHectares) || sizeHectares < 0)) return NextResponse.json({ error: "sizeHectares inválido" }, { status: 400 });
  if (capacity !== null && (!Number.isInteger(capacity) || capacity < 0)) return NextResponse.json({ error: "capacity inválida" }, { status: 400 });
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("sections")
    .insert({
      farm_id: result.farmId,
      name,
      size_hectares: sizeHectares,
      capacity,
      color: body.color || "#22c55e",
      water_status: body.waterStatus || "bueno",
      pasture_status: body.pastureStatus || "bueno",
      notes: body.notes || null,
    })
    .select()
    .single();

  if (error) return databaseFailure("sections POST", error);
  return NextResponse.json(data);
}

export async function PUT(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const parsed = await parseJsonBody(req);
  if ("error" in parsed) return parsed.error;
  const body = parsed.data;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const sizeHectares = body.sizeHectares == null || body.sizeHectares === "" ? null : Number(body.sizeHectares);
  const capacity = body.capacity == null || body.capacity === "" ? null : Number(body.capacity);
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  if (sizeHectares !== null && (!Number.isFinite(sizeHectares) || sizeHectares < 0)) return NextResponse.json({ error: "sizeHectares inválido" }, { status: 400 });
  if (capacity !== null && (!Number.isInteger(capacity) || capacity < 0)) return NextResponse.json({ error: "capacity inválida" }, { status: 400 });
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("sections")
    .update({
      name,
      size_hectares: sizeHectares,
      capacity,
      color: body.color,
      water_status: body.waterStatus,
      pasture_status: body.pastureStatus,
      notes: body.notes,
    })
    .eq("id", body.id)
    .eq("farm_id", result.farmId)
    .select()
    .single();

  if (error) return databaseFailure("sections PUT", error);
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
    .from("sections")
    .delete()
    .eq("id", id)
    .eq("farm_id", result.farmId);

  if (error) return databaseFailure("sections DELETE", error);
  return NextResponse.json({ ok: true });
}
