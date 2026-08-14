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
    .from("vaccinations")
    .select("*, cattle(category, breed, count), sections(name)")
    .eq("farm_id", result.farmId)
    .order("date_applied", { ascending: false })
    .limit(100);

  if (error) return databaseFailure("vaccinations GET", error);
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

  const headCount = body.headCount == null || body.headCount === "" ? 1 : Number(body.headCount);
  if (typeof body.vaccineName !== "string" || !body.vaccineName.trim()) return NextResponse.json({ error: "vaccineName required" }, { status: 400 });
  if (!Number.isInteger(headCount) || headCount < 1) return NextResponse.json({ error: "headCount must be positive" }, { status: 400 });

  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("vaccinations")
    .insert({
      farm_id: result.farmId,
      cattle_id: body.cattleId || null,
      section_id: body.sectionId || null,
      vaccine_name: body.vaccineName,
      date_applied: body.dateApplied || new Date().toISOString(),
      next_due: body.nextDue || null,
      head_count: headCount,
      applied_by: body.appliedBy || null,
      batch_number: body.batchNumber || null,
      notes: body.notes || null,
    })
    .select()
    .single();

  if (error) return databaseFailure("vaccinations POST", error);
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
    .from("vaccinations")
    .delete()
    .eq("id", id)
    .eq("farm_id", result.farmId);

  if (error) return databaseFailure("vaccinations DELETE", error);
  return NextResponse.json({ ok: true });
}
