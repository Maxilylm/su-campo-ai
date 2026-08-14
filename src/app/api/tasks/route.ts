import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { farmRelationError, requireFarm, validateFarmRelations } from "@/lib/auth";
import { parseJsonBody } from "@/lib/request";
import { databaseFailure } from "@/lib/api-error";

const PRIORITIES = new Set(["low", "medium", "high"]);
const STATUSES = new Set(["pending", "completed"]);

function isMissingTasksTable(error: { code?: string; message?: string } | null): boolean {
  return error?.code === "PGRST205"
    || error?.code === "42P01"
    || /(?:relation|table).*tasks.*(?:does not exist|not found)/i.test(error?.message || "");
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function validateTaskFields(body: Record<string, unknown>, requireTitle = false): string | null {
  if (requireTitle && (typeof body.title !== "string" || !body.title.trim())) return "El título es obligatorio.";
  if (typeof body.title === "string" && (!body.title.trim() || body.title.trim().length > 160)) return "El título debe tener entre 1 y 160 caracteres.";
  if (typeof body.description === "string" && body.description.length > 2000) return "La descripción es demasiado larga.";
  if (body.dueDate != null && body.dueDate !== "" && !validDate(body.dueDate)) return "Fecha de vencimiento inválida.";
  if (body.priority != null && !PRIORITIES.has(String(body.priority))) return "Prioridad inválida.";
  if (body.status != null && !STATUSES.has(String(body.status))) return "Estado inválido.";
  return null;
}

async function checkRelations(farmId: string, body: Record<string, unknown>) {
  const relationCheck = await validateFarmRelations(farmId, [
    { table: "sections", id: body.sectionId },
    { table: "cattle", id: body.cattleId },
    { table: "crops", id: body.cropId },
  ]);
  return relationCheck.ok ? null : farmRelationError(relationCheck);
}

export async function GET() {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const { data, error } = await getSupabaseAdmin()
    .from("tasks")
    .select("*, sections(name), cattle(category, count), crops(crop_type)")
    .eq("farm_id", result.farmId)
    .order("status", { ascending: true })
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(500);

  if (error && isMissingTasksTable(error)) {
    return NextResponse.json({ tasks: [], migrationRequired: true });
  }
  if (error) return databaseFailure("tasks GET", error);
  return NextResponse.json({ tasks: data || [], migrationRequired: false });
}

export async function POST(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;
  const parsed = await parseJsonBody(req);
  if ("error" in parsed) return parsed.error;
  const body = parsed.data;
  const validationError = validateTaskFields(body, true);
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });
  const relationError = await checkRelations(result.farmId, body);
  if (relationError) return relationError;

  const { data, error } = await getSupabaseAdmin()
    .from("tasks")
    .insert({
      farm_id: result.farmId,
      title: String(body.title).trim(),
      description: typeof body.description === "string" && body.description.trim() ? body.description.trim() : null,
      due_date: body.dueDate || null,
      priority: body.priority || "medium",
      section_id: body.sectionId || null,
      cattle_id: body.cattleId || null,
      crop_id: body.cropId || null,
    })
    .select("*, sections(name), cattle(category, count), crops(crop_type)")
    .single();

  if (error && isMissingTasksTable(error)) return NextResponse.json({ error: "Aplicá la migración 014_tasks.sql para activar la agenda." }, { status: 503 });
  if (error) return databaseFailure("tasks POST", error);
  return NextResponse.json(data);
}

export async function PUT(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;
  const parsed = await parseJsonBody(req);
  if ("error" in parsed) return parsed.error;
  const body = parsed.data;
  if (typeof body.id !== "string" || !body.id) return NextResponse.json({ error: "id requerido" }, { status: 400 });
  const validationError = validateTaskFields(body);
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });
  const relationError = await checkRelations(result.farmId, body);
  if (relationError) return relationError;

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.title === "string") update.title = body.title.trim();
  if (Object.prototype.hasOwnProperty.call(body, "description")) update.description = body.description || null;
  if (Object.prototype.hasOwnProperty.call(body, "dueDate")) update.due_date = body.dueDate || null;
  if (body.priority != null) update.priority = body.priority;
  if (body.status != null) {
    update.status = body.status;
    update.completed_at = body.status === "completed" ? new Date().toISOString() : null;
  }
  for (const [input, column] of [["sectionId", "section_id"], ["cattleId", "cattle_id"], ["cropId", "crop_id"]] as const) {
    if (Object.prototype.hasOwnProperty.call(body, input)) update[column] = body[input] || null;
  }

  const { data, error } = await getSupabaseAdmin()
    .from("tasks")
    .update(update)
    .eq("id", body.id)
    .eq("farm_id", result.farmId)
    .select("*, sections(name), cattle(category, count), crops(crop_type)")
    .single();

  if (error && isMissingTasksTable(error)) return NextResponse.json({ error: "Aplicá la migración 014_tasks.sql para activar la agenda." }, { status: 503 });
  if (error) return databaseFailure("tasks PUT", error);
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;
  const parsed = await parseJsonBody(req);
  if ("error" in parsed) return parsed.error;
  if (typeof parsed.data.id !== "string" || !parsed.data.id) return NextResponse.json({ error: "id requerido" }, { status: 400 });

  const { error } = await getSupabaseAdmin()
    .from("tasks")
    .delete()
    .eq("id", parsed.data.id)
    .eq("farm_id", result.farmId);

  if (error && isMissingTasksTable(error)) return NextResponse.json({ error: "Aplicá la migración 014_tasks.sql para activar la agenda." }, { status: 503 });
  if (error) return databaseFailure("tasks DELETE", error);
  return NextResponse.json({ ok: true });
}
