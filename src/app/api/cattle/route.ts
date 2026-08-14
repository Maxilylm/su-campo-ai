import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { farmRelationError, requireFarm, validateFarmRelations } from "@/lib/auth";
import { parseJsonBody } from "@/lib/request";
import { databaseFailure } from "@/lib/api-error";

export async function GET() {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("cattle")
    .select("*, sections(name)")
    .eq("farm_id", result.farmId)
    .order("category")
    .limit(500);

  if (error) return databaseFailure("cattle GET", error);
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const parsed = await parseJsonBody(req);
  if ("error" in parsed) return parsed.error;
  const body = parsed.data;
  const relationCheck = await validateFarmRelations(result.farmId, [
    { table: "sections", id: body.sectionId },
  ]);
  if (!relationCheck.ok) return farmRelationError(relationCheck);

  const categories = new Set(["vaca", "toro", "ternero", "ternera", "novillo", "vaquillona", "caballo", "yegua", "oveja"]);
  const count = body.count == null || body.count === "" ? 1 : Number(body.count);
  const weight = body.weightKg == null || body.weightKg === "" ? null : Number(body.weightKg);
  if (!Number.isInteger(count) || count < 1) return NextResponse.json({ error: "count must be a positive integer" }, { status: 400 });
  if (body.category != null && (!categories.has(String(body.category)))) return NextResponse.json({ error: "category inválida" }, { status: 400 });
  if (weight !== null && (!Number.isFinite(weight) || weight <= 0)) return NextResponse.json({ error: "weightKg must be positive" }, { status: 400 });

  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("cattle")
    .insert({
      farm_id: result.farmId,
      section_id: body.sectionId || null,
      category: body.category || "vaca",
      breed: body.breed || null,
      count,
      tag_range: body.tagRange || null,
      ear_tag: body.earTag || null,
      health_status: body.healthStatus || "healthy",
      weight_kg: weight,
      birth_date: body.birthDate || null,
      origin: body.origin || "propio",
      vaccination_status: body.vaccinationStatus || "pendiente",
      reproductive_status: body.reproductiveStatus || null,
      notes: body.notes || null,
    })
    .select("*, sections(name)")
    .single();

  if (error) return databaseFailure("cattle POST", error);
  return NextResponse.json(data);
}

export async function PUT(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const parsed = await parseJsonBody(req);
  if ("error" in parsed) return parsed.error;
  const body = parsed.data;
  const relationCheck = await validateFarmRelations(result.farmId, [
    { table: "sections", id: body.sectionId },
  ]);
  if (!relationCheck.ok) return farmRelationError(relationCheck);

  const count = Number(body.count);
  const weight = body.weightKg == null || body.weightKg === "" ? null : Number(body.weightKg);
  if (!Number.isInteger(count) || count < 1) return NextResponse.json({ error: "count must be a positive integer" }, { status: 400 });
  if (weight !== null && (!Number.isFinite(weight) || weight <= 0)) return NextResponse.json({ error: "weightKg must be positive" }, { status: 400 });

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

  if (error) return databaseFailure("cattle PUT", error);
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
    .from("cattle")
    .delete()
    .eq("id", id)
    .eq("farm_id", result.farmId);

  if (error) return databaseFailure("cattle DELETE", error);
  return NextResponse.json({ ok: true });
}
