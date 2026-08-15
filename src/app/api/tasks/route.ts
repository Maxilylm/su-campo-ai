import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { farmRelationError, farmSectionError, requireFarm, validateFarmRelations, validateFarmSectionConsistency } from "@/lib/auth";
import { parseJsonBody } from "@/lib/request";
import { databaseFailure } from "@/lib/api-error";
import { SUPABASE_READ_TIMEOUT_MS, withTimeout } from "@/lib/timeout";
import { isValidDateOnly } from "@/lib/date";
import { parseIdempotencyKey } from "@/lib/idempotency";

const PRIORITIES = new Set(["low", "medium", "high"]);
const STATUSES = new Set(["pending", "completed"]);
const TASKS_QUERY_TIMEOUT_MS = 7000;
const TASK_SELECT = "*, sections(name), cattle(category, count), crops(crop_type)";

function taskIdempotencyMigrationRequired() {
  return NextResponse.json({
    error: "Aplicá la migración 022 para habilitar reintentos seguros de tareas.",
    code: "task_idempotency_migration_required",
    migration: "supabase/022_task_idempotency.sql",
  }, { status: 503 });
}

function isMissingTasksTable(error: { code?: string; message?: string } | null): boolean {
  return error?.code === "PGRST205"
    || error?.code === "42P01"
    || /(?:relation|table).*tasks.*(?:does not exist|not found)/i.test(error?.message || "");
}

function validDate(value: unknown): value is string {
  return isValidDateOnly(value);
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
  if (!relationCheck.ok) return farmRelationError(relationCheck);
  const sectionValidation = await validateFarmSectionConsistency(farmId, body.sectionId, [
    { table: "cattle", id: body.cattleId, label: "la hacienda" },
    { table: "crops", id: body.cropId, label: "el cultivo" },
  ]);
  return sectionValidation.ok ? null : farmSectionError(sectionValidation);
}

export async function GET() {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const queryResult = await withTimeout(
    getSupabaseAdmin()
      .from("tasks")
      .select(TASK_SELECT)
      .eq("farm_id", result.farmId)
      .order("status", { ascending: true })
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(500),
    TASKS_QUERY_TIMEOUT_MS,
    null,
  );

  if (!queryResult) {
    return NextResponse.json({ error: "La agenda tardó demasiado. Intentá nuevamente." }, { status: 504 });
  }

  const { data, error } = queryResult;

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
  const idempotencyKey = parseIdempotencyKey(req.headers.get("idempotency-key"));
  if (idempotencyKey === false) return NextResponse.json({ error: "Idempotency-Key inválida" }, { status: 400 });
  const validationError = validateTaskFields(body, true);
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });
  const relationError = await checkRelations(result.farmId, body);
  if (relationError) return relationError;

  const db = getSupabaseAdmin();
  if (idempotencyKey) {
    const existingLookup = await withTimeout(
      db.from("tasks")
        .select(TASK_SELECT)
        .eq("farm_id", result.farmId)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle(),
      SUPABASE_READ_TIMEOUT_MS,
      null,
    );
    if (!existingLookup) {
      return NextResponse.json({ error: "Supabase tardó demasiado al verificar el reintento de la tarea. Intentá nuevamente.", code: "task_idempotency_lookup_timeout" }, { status: 504 });
    }
    const { data: existing, error: existingError } = existingLookup;
    // A legacy tasks table may not have the optional key column yet; the
    // insert below returns the actionable migration response in that case.
    if (existingError && !["PGRST204", "PGRST205"].includes(existingError.code || "")) {
      return databaseFailure("tasks idempotency lookup", existingError);
    }
    if (existing) return NextResponse.json(existing);
  }

  const { data, error } = await db
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
      ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
    })
    .select(TASK_SELECT)
    .single();

  if (error && isMissingTasksTable(error)) return NextResponse.json({ error: "Aplicá la migración 014_tasks.sql para activar la agenda." }, { status: 503 });
  if (error?.code === "PGRST204" && idempotencyKey) return taskIdempotencyMigrationRequired();
  if (error?.code === "23505" && idempotencyKey) {
    const replayLookup = await withTimeout(
      db.from("tasks")
        .select(TASK_SELECT)
        .eq("farm_id", result.farmId)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle(),
      SUPABASE_READ_TIMEOUT_MS,
      null,
    );
    if (!replayLookup) {
      return NextResponse.json({ error: "Supabase tardó demasiado al resolver el reintento de la tarea. Intentá nuevamente.", code: "task_idempotency_lookup_timeout" }, { status: 504 });
    }
    if (replayLookup.error && replayLookup.error.code !== "PGRST116") return databaseFailure("tasks idempotency replay", replayLookup.error);
    if (replayLookup.data) return NextResponse.json(replayLookup.data);
  }
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
    .select(TASK_SELECT)
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

  const { data: deleted, error } = await getSupabaseAdmin()
    .from("tasks")
    .delete()
    .eq("id", parsed.data.id)
    .eq("farm_id", result.farmId)
    .select("id")
    .maybeSingle();

  if (error && isMissingTasksTable(error)) return NextResponse.json({ error: "Aplicá la migración 014_tasks.sql para activar la agenda." }, { status: 503 });
  if (error) return databaseFailure("tasks DELETE", error);
  if (!deleted) return NextResponse.json({ error: "Tarea no encontrada" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
