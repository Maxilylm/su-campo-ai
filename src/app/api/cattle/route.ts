import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { farmRelationError, requireFarm, validateFarmRelations } from "@/lib/auth";
import { parseJsonBody } from "@/lib/request";
import { databaseFailure } from "@/lib/api-error";
import { earTagCandidates, isValidCattleCategory, normalizedEarTag } from "@/lib/cattle";
import { isValidDateValue } from "@/lib/date";
import { SUPABASE_READ_TIMEOUT_MS, withTimeout } from "@/lib/timeout";

function text(value: unknown, maxLength = 500): string | null {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function earTagConflict() {
  return NextResponse.json(
    { error: "La caravana ya está asignada a otro registro de este campo.", code: "cattle_ear_tag_already_used" },
    { status: 409 },
  );
}

function isUniqueViolation(error: { code?: string }) {
  return error.code === "23505";
}

const MAX_CATTLE_RESPONSE = 500;

async function findEarTagConflict(
  db: ReturnType<typeof getSupabaseAdmin>,
  farmId: string,
  earTag: string | null,
  excludeId?: string,
) {
  const normalized = normalizedEarTag(earTag);
  if (!normalized) return { conflict: false, error: null, timedOut: false };
  const candidates = earTagCandidates(earTag);

  let query = db
    .from("cattle")
    .select("id, ear_tag")
    .eq("farm_id", farmId)
    .in("ear_tag", candidates)
    .limit(candidates.length * 2);
  if (excludeId) query = query.neq("id", excludeId);
  const queryResult = await withTimeout(query, SUPABASE_READ_TIMEOUT_MS, null);
  if (!queryResult) return { conflict: false, error: null, timedOut: true };
  const { data, error } = queryResult;
  if (error) return { conflict: false, error, timedOut: false };
  return {
    conflict: (data || []).some((row) => normalizedEarTag(row.ear_tag) === normalized),
    error: null,
    timedOut: false,
  };
}

export async function GET(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const db = getSupabaseAdmin();
  let query = db
    .from("cattle")
    .select("*, sections(name)")
    .eq("farm_id", result.farmId)
    .order("category")
    .limit(MAX_CATTLE_RESPONSE + 1);
  if (req.nextUrl.searchParams.get("unassigned") === "true") {
    query = query.is("section_id", null);
  }

  const queryResult = await withTimeout(query, SUPABASE_READ_TIMEOUT_MS, null);
  if (!queryResult) return NextResponse.json({ error: "Hacienda tardó demasiado. Intentá nuevamente." }, { status: 504 });
  const { data, error } = queryResult;

  if (error) return databaseFailure("cattle GET", error);
  const rows = data || [];
  const truncated = rows.length > MAX_CATTLE_RESPONSE;
  const response = NextResponse.json(rows.slice(0, MAX_CATTLE_RESPONSE));
  response.headers.set("X-CampoAI-Cattle-Limit", String(MAX_CATTLE_RESPONSE));
  if (truncated) response.headers.set("X-CampoAI-Cattle-Truncated", "true");
  return response;
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

  const count = body.count == null || body.count === "" ? 1 : Number(body.count);
  const weight = body.weightKg == null || body.weightKg === "" ? null : Number(body.weightKg);
  if (!Number.isInteger(count) || count < 1) return NextResponse.json({ error: "count must be a positive integer" }, { status: 400 });
  const category = body.category == null || body.category === "" ? "vaca" : body.category;
  if (!isValidCattleCategory(category)) return NextResponse.json({ error: "category inválida" }, { status: 400 });
  if (weight !== null && (!Number.isFinite(weight) || weight <= 0)) return NextResponse.json({ error: "weightKg must be positive" }, { status: 400 });
  if (body.birthDate != null && body.birthDate !== "" && !isValidDateValue(body.birthDate)) return NextResponse.json({ error: "birthDate inválida" }, { status: 400 });

  const db = getSupabaseAdmin();
  const earTag = text(body.earTag, 100);
  const earTagCheck = await findEarTagConflict(db, result.farmId, earTag);
  if (earTagCheck.timedOut) {
    return NextResponse.json(
      { error: "No se pudo verificar la caravana porque Supabase tardó demasiado. Intentá nuevamente.", code: "cattle_ear_tag_lookup_timeout" },
      { status: 504 },
    );
  }
  if (earTagCheck.error) return databaseFailure("cattle POST ear tag lookup", earTagCheck.error);
  if (earTagCheck.conflict) return earTagConflict();
  const { data, error } = await db
    .from("cattle")
    .insert({
      farm_id: result.farmId,
      section_id: body.sectionId || null,
      category,
      breed: body.breed || null,
      count,
      tag_range: body.tagRange || null,
      ear_tag: earTag,
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

  if (error) return isUniqueViolation(error) ? earTagConflict() : databaseFailure("cattle POST", error);
  return NextResponse.json(data);
}

export async function PUT(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const parsed = await parseJsonBody(req);
  if ("error" in parsed) return parsed.error;
  const body = parsed.data;
  if (typeof body.id !== "string" || !body.id) return NextResponse.json({ error: "id requerido" }, { status: 400 });
  const relationCheck = await validateFarmRelations(result.farmId, [
    { table: "sections", id: body.sectionId },
  ]);
  if (!relationCheck.ok) return farmRelationError(relationCheck);

  const count = Number(body.count);
  const weight = body.weightKg == null || body.weightKg === "" ? null : Number(body.weightKg);
  if (!isValidCattleCategory(body.category)) return NextResponse.json({ error: "category inválida" }, { status: 400 });
  if (!Number.isInteger(count) || count < 1) return NextResponse.json({ error: "count must be a positive integer" }, { status: 400 });
  if (weight !== null && (!Number.isFinite(weight) || weight <= 0)) return NextResponse.json({ error: "weightKg must be positive" }, { status: 400 });
  if (body.birthDate != null && body.birthDate !== "" && !isValidDateValue(body.birthDate)) return NextResponse.json({ error: "birthDate inválida" }, { status: 400 });

  const db = getSupabaseAdmin();
  const earTag = text(body.earTag, 100);
  const earTagCheck = await findEarTagConflict(db, result.farmId, earTag, body.id);
  if (earTagCheck.timedOut) {
    return NextResponse.json(
      { error: "No se pudo verificar la caravana porque Supabase tardó demasiado. Intentá nuevamente.", code: "cattle_ear_tag_lookup_timeout" },
      { status: 504 },
    );
  }
  if (earTagCheck.error) return databaseFailure("cattle PUT ear tag lookup", earTagCheck.error);
  if (earTagCheck.conflict) return earTagConflict();
  const { data, error } = await db
    .from("cattle")
    .update({
      section_id: body.sectionId,
      category: body.category,
      breed: body.breed,
      count,
      tag_range: body.tagRange,
      ear_tag: earTag,
      health_status: body.healthStatus,
      weight_kg: weight,
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

  if (error) return isUniqueViolation(error) ? earTagConflict() : databaseFailure("cattle PUT", error);
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
    .from("cattle")
    .delete()
    .eq("id", id)
    .eq("farm_id", result.farmId)
    .select("id")
    .maybeSingle();

  if (error) return databaseFailure("cattle DELETE", error);
  if (!deleted) return NextResponse.json({ error: "Hacienda no encontrada" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
