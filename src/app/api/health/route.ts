import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { farmRelationError, farmSectionError, requireFarm, validateFarmRelations, validateFarmSectionConsistency } from "@/lib/auth";
import { parseJsonBody } from "@/lib/request";
import { databaseFailure } from "@/lib/api-error";
import { isValidDateValue } from "@/lib/date";

const HEALTH_TYPES = new Set(["nacimiento", "muerte", "enfermedad", "lesion", "tratamiento", "revision", "desparasitacion", "destete", "castrado"]);

export async function GET() {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("health_events")
    .select("*, cattle(category, breed, count), sections(name)")
    .eq("farm_id", result.farmId)
    .order("date_occurred", { ascending: false })
    .limit(100);

  if (error) return databaseFailure("health GET", error);
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const parsed = await parseJsonBody(req);
  if ("error" in parsed) return parsed.error;
  const body = parsed.data;
  const relationCheck = await validateFarmRelations(result.farmId, [
    { table: "cattle", id: body.cattleId },
    { table: "sections", id: body.sectionId },
  ]);
  if (!relationCheck.ok) return farmRelationError(relationCheck);
  const sectionValidation = await validateFarmSectionConsistency(result.farmId, body.sectionId, [
    { table: "cattle", id: body.cattleId, label: "la hacienda" },
  ]);
  if (!sectionValidation.ok) return farmSectionError(sectionValidation);

  const headCount = body.headCount == null || body.headCount === "" ? 1 : Number(body.headCount);
  if (typeof body.type !== "string" || !HEALTH_TYPES.has(body.type)) return NextResponse.json({ error: "type inválido" }, { status: 400 });
  if (typeof body.description !== "string" || !body.description.trim()) return NextResponse.json({ error: "description required" }, { status: 400 });
  if (!Number.isInteger(headCount) || headCount < 1) return NextResponse.json({ error: "headCount must be positive" }, { status: 400 });
  if (body.dateOccurred != null && body.dateOccurred !== "" && !isValidDateValue(body.dateOccurred)) return NextResponse.json({ error: "Fecha del evento inválida" }, { status: 400 });

  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("health_events")
    .insert({
      farm_id: result.farmId,
      cattle_id: body.cattleId || null,
      section_id: body.sectionId || null,
      type: body.type,
      description: body.description,
      date_occurred: body.dateOccurred || new Date().toISOString(),
      head_count: headCount,
      resolved: body.resolved === true,
      veterinarian: body.veterinarian || null,
      notes: body.notes || null,
    })
    .select()
    .single();

  if (error) return databaseFailure("health POST", error);
  return NextResponse.json(data);
}

export async function PUT(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const parsed = await parseJsonBody(req);
  if ("error" in parsed) return parsed.error;
  const body = parsed.data;
  if (typeof body.id !== "string" || !body.id) return NextResponse.json({ error: "id requerido" }, { status: 400 });
  const fullUpdate = ["type", "description", "headCount", "dateOccurred", "sectionId", "cattleId", "veterinarian", "notes"].some((key) => Object.prototype.hasOwnProperty.call(body, key));

  if (!fullUpdate) {
    if (typeof body.resolved !== "boolean") return NextResponse.json({ error: "resolved must be boolean" }, { status: 400 });
    const db = getSupabaseAdmin();
    const { data, error } = await db
      .from("health_events")
      .update({ resolved: body.resolved })
      .eq("id", body.id)
      .eq("farm_id", result.farmId)
      .select()
      .single();

    if (error) return databaseFailure("health PUT status", error);
    return NextResponse.json(data);
  }

  const relationCheck = await validateFarmRelations(result.farmId, [
    { table: "cattle", id: body.cattleId },
    { table: "sections", id: body.sectionId },
  ]);
  if (!relationCheck.ok) return farmRelationError(relationCheck);
  const sectionValidation = await validateFarmSectionConsistency(result.farmId, body.sectionId, [
    { table: "cattle", id: body.cattleId, label: "la hacienda" },
  ]);
  if (!sectionValidation.ok) return farmSectionError(sectionValidation);

  const headCount = body.headCount == null || body.headCount === "" ? 1 : Number(body.headCount);
  if (typeof body.type !== "string" || !HEALTH_TYPES.has(body.type)) return NextResponse.json({ error: "type inválido" }, { status: 400 });
  if (typeof body.description !== "string" || !body.description.trim()) return NextResponse.json({ error: "description required" }, { status: 400 });
  if (!Number.isInteger(headCount) || headCount < 1) return NextResponse.json({ error: "headCount must be positive" }, { status: 400 });
  if (body.resolved != null && typeof body.resolved !== "boolean") return NextResponse.json({ error: "resolved must be boolean" }, { status: 400 });
  if (body.dateOccurred != null && body.dateOccurred !== "" && !isValidDateValue(body.dateOccurred)) return NextResponse.json({ error: "Fecha del evento inválida" }, { status: 400 });

  const updatePayload: Record<string, unknown> = {
    section_id: body.sectionId || null,
    type: body.type,
    description: body.description,
    date_occurred: body.dateOccurred || new Date().toISOString(),
    head_count: headCount,
    ...(body.resolved != null ? { resolved: body.resolved } : {}),
    veterinarian: body.veterinarian || null,
    notes: body.notes || null,
  };
  // Preserve an existing cattle relation when editing from the current UI,
  // which does not expose a cattle selector yet. A future form can send null
  // explicitly to clear it.
  if (Object.prototype.hasOwnProperty.call(body, "cattleId")) {
    updatePayload.cattle_id = body.cattleId || null;
  }

  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("health_events")
    .update(updatePayload)
    .eq("id", body.id)
    .eq("farm_id", result.farmId)
    .select()
    .single();

  if (error) return databaseFailure("health PUT", error);
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
    .from("health_events")
    .delete()
    .eq("id", id)
    .eq("farm_id", result.farmId)
    .select("id")
    .maybeSingle();

  if (error) return databaseFailure("health DELETE", error);
  if (!deleted) return NextResponse.json({ error: "Evento sanitario no encontrado" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
