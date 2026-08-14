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

  const healthTypes = new Set(["nacimiento", "muerte", "enfermedad", "lesion", "tratamiento", "revision", "desparasitacion", "destete", "castrado"]);
  const headCount = body.headCount == null || body.headCount === "" ? 1 : Number(body.headCount);
  if (typeof body.type !== "string" || !healthTypes.has(body.type)) return NextResponse.json({ error: "type inválido" }, { status: 400 });
  if (typeof body.description !== "string" || !body.description.trim()) return NextResponse.json({ error: "description required" }, { status: 400 });
  if (!Number.isInteger(headCount) || headCount < 1) return NextResponse.json({ error: "headCount must be positive" }, { status: 400 });

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
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("health_events")
    .update({ resolved: body.resolved })
    .eq("id", body.id)
    .eq("farm_id", result.farmId)
    .select()
    .single();

  if (error) return databaseFailure("health PUT", error);
  return NextResponse.json(data);
}
