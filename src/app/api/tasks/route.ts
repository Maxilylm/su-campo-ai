import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { farmRelationError, farmSectionError, requireFarm, validateFarmRelations, validateFarmSectionConsistency } from "@/lib/auth";
import { parseJsonBody } from "@/lib/request";
import { databaseFailure } from "@/lib/api-error";
import { SUPABASE_READ_TIMEOUT_MS, withTimeout } from "@/lib/timeout";
import { isValidDateOnly } from "@/lib/date";
import { parseIdempotencyKey } from "@/lib/idempotency";
import { splitPage } from "@/lib/pagination";
import { isMissingSchemaElement } from "@/lib/service-status";
import { isTaskStatus } from "@/lib/tasks";
import { isUuid } from "@/lib/uuid";

const PRIORITIES = new Set(["low", "medium", "high"]);
const BOARD_MIGRATION = "supabase/053_task_status_and_assignee.sql";
const TASKS_QUERY_TIMEOUT_MS = 7000;
const TASK_SELECT = "*, sections(name), cattle(category, count), crops(crop_type)";
const MAX_TASK_RESPONSE = 500;

function taskWriteTimeout(action: string) {
  return NextResponse.json(
    { error: `Supabase tardó demasiado al ${action}. Intentá nuevamente.`, code: "task_write_timeout" },
    { status: 504 },
  );
}

function taskIdempotencyMigrationRequired() {
  return NextResponse.json({
    error: "Aplicá la migración 022 para habilitar reintentos seguros de tareas.",
    code: "task_idempotency_migration_required",
    migration: "supabase/022_task_idempotency.sql",
  }, { status: 503 });
}

/** 503 for a write that needs 053 ("En curso" or an assignee) before it is applied. */
function taskBoardMigrationRequired() {
  return NextResponse.json({
    error: "Aplicá la migración 053 para usar \"En curso\" y asignar tareas.",
    code: "task_board_migration_required",
    migration: BOARD_MIGRATION,
  }, { status: 503 });
}

type DbError = { code?: string; message?: string; hint?: string } | null;

/** The write failed because 053 is missing: no assigned_to column, or the old
 * CHECK rejected in_progress. */
function needsBoardMigration(error: DbError, body: Record<string, unknown>): boolean {
  if (!error) return false;
  const touchesAssignee = Object.prototype.hasOwnProperty.call(body, "assignedTo");
  if (touchesAssignee && isMissingSchemaElement(error) && /assigned_to/i.test(error.message || "")) return true;
  return body.status === "in_progress" && error.code === "23514";
}

function isAssigneeRejected(error: DbError): boolean {
  return error?.code === "23503" && error.hint === "task_assignee_not_member";
}

function assigneeNotMember() {
  return NextResponse.json({ error: "La persona asignada no es miembro de este campo. Elegí a alguien de la lista de miembros.", code: "task_assignee_not_member" }, { status: 400 });
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
  if (body.status != null && !isTaskStatus(body.status)) return "Estado inválido.";
  if (body.assignedTo != null && body.assignedTo !== "" && !isUuid(body.assignedTo)) return "Persona asignada inválida.";
  return null;
}

/** assignedTo must be a member of the farm (farm_members, or the legacy
 * farms.user_id owner). The 053 trigger enforces the same rule in SQL. */
async function checkAssignee(farmId: string, body: Record<string, unknown>): Promise<Response | null> {
  if (!Object.prototype.hasOwnProperty.call(body, "assignedTo") || !body.assignedTo) return null;
  const userId = String(body.assignedTo);
  const db = getSupabaseAdmin();
  const lookup = await withTimeout(
    Promise.all([
      db.from("farm_members").select("user_id").eq("farm_id", farmId).eq("user_id", userId).maybeSingle(),
      db.from("farms").select("id").eq("id", farmId).eq("user_id", userId).maybeSingle(),
    ]),
    SUPABASE_READ_TIMEOUT_MS,
    null,
  );
  if (!lookup) return NextResponse.json({ error: "Supabase tardó demasiado al verificar la persona asignada. Intentá nuevamente.", code: "task_assignee_timeout" }, { status: 504 });
  const [member, owner] = lookup;
  // Before 031 there is no farm_members table; the owner check still applies.
  if (member.error && member.error.code !== "PGRST205") return databaseFailure("tasks assignee lookup", member.error);
  if (owner.error) return databaseFailure("tasks assignee owner lookup", owner.error);
  return member.data || owner.data ? null : assigneeNotMember();
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

  const db = getSupabaseAdmin();
  const queries = await withTimeout(
    Promise.all([
      db
        .from("tasks")
        .select(TASK_SELECT, { count: "exact" })
        .eq("farm_id", result.farmId)
        // Descending puts open work first (pending, in_progress, completed),
        // so the 500-row cap drops old completed tasks, not open ones.
        .order("status", { ascending: false })
        .order("due_date", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(MAX_TASK_RESPONSE + 1),
      // Is 053 applied? `*` above cannot tell when the farm has no tasks.
      db.from("tasks").select("assigned_to").eq("farm_id", result.farmId).limit(1),
    ]),
    TASKS_QUERY_TIMEOUT_MS,
    null,
  );

  if (!queries) {
    return NextResponse.json({ error: "La agenda tardó demasiado. Intentá nuevamente." }, { status: 504 });
  }

  const [queryResult, boardProbe] = queries;
  const { data, count, error } = queryResult;
  const boardMigrationRequired = Boolean(boardProbe.error && isMissingSchemaElement(boardProbe.error));

  if (error && isMissingTasksTable(error)) {
    return NextResponse.json({ tasks: [], migrationRequired: true, boardMigrationRequired: true });
  }
  if (error) return databaseFailure("tasks GET", error);
  const page = splitPage(data || [], MAX_TASK_RESPONSE);
  const response = NextResponse.json({ tasks: page.items, migrationRequired: false, boardMigrationRequired });
  response.headers.set("X-CampoAI-Tasks-Limit", String(MAX_TASK_RESPONSE));
  if (page.hasMore || (count ?? 0) > MAX_TASK_RESPONSE) {
    response.headers.set("X-CampoAI-Tasks-Truncated", "true");
  }
  return response;
}

export async function POST(req: NextRequest) {
  const result = await requireFarm({ write: true });
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
  const assigneeError = await checkAssignee(result.farmId, body);
  if (assigneeError) return assigneeError;

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

  const insertResult = await withTimeout(
    db
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
        // Only sent when set, so creating tasks keeps working before 053.
        ...(body.assignedTo ? { assigned_to: body.assignedTo } : {}),
        ...(isTaskStatus(body.status) && body.status !== "pending" ? { status: body.status, completed_at: body.status === "completed" ? new Date().toISOString() : null } : {}),
        ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
      })
      .select(TASK_SELECT)
      .single(),
    SUPABASE_READ_TIMEOUT_MS,
    null,
  );
  if (!insertResult) return taskWriteTimeout("crear la tarea");
  const { data, error } = insertResult;

  if (error && isMissingTasksTable(error)) return NextResponse.json({ error: "Aplicá la migración 014_tasks.sql para activar la agenda." }, { status: 503 });
  if (needsBoardMigration(error, body)) return taskBoardMigrationRequired();
  if (isAssigneeRejected(error)) return assigneeNotMember();
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
  const result = await requireFarm({ write: true });
  if ("error" in result) return result.error;
  const parsed = await parseJsonBody(req);
  if ("error" in parsed) return parsed.error;
  const body = parsed.data;
  if (typeof body.id !== "string" || !body.id) return NextResponse.json({ error: "id requerido" }, { status: 400 });
  const validationError = validateTaskFields(body);
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });
  const relationError = await checkRelations(result.farmId, body);
  if (relationError) return relationError;
  const assigneeError = await checkAssignee(result.farmId, body);
  if (assigneeError) return assigneeError;

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
  if (Object.prototype.hasOwnProperty.call(body, "assignedTo")) update.assigned_to = body.assignedTo || null;

  const updateResult = await withTimeout(
    getSupabaseAdmin()
      .from("tasks")
      .update(update)
      .eq("id", body.id)
      .eq("farm_id", result.farmId)
      .select(TASK_SELECT)
      .single(),
    SUPABASE_READ_TIMEOUT_MS,
    null,
  );
  if (!updateResult) return taskWriteTimeout("actualizar la tarea");
  const { data, error } = updateResult;

  if (error && isMissingTasksTable(error)) return NextResponse.json({ error: "Aplicá la migración 014_tasks.sql para activar la agenda." }, { status: 503 });
  if (needsBoardMigration(error, body)) return taskBoardMigrationRequired();
  if (isAssigneeRejected(error)) return assigneeNotMember();
  if (error?.code === "PGRST116") return NextResponse.json({ error: "Tarea no encontrada" }, { status: 404 });
  if (error) return databaseFailure("tasks PUT", error);
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest) {
  const result = await requireFarm({ write: true });
  if ("error" in result) return result.error;
  const parsed = await parseJsonBody(req);
  if ("error" in parsed) return parsed.error;
  if (typeof parsed.data.id !== "string" || !parsed.data.id) return NextResponse.json({ error: "id requerido" }, { status: 400 });

  const deleteResult = await withTimeout(
    getSupabaseAdmin()
      .from("tasks")
      .delete()
      .eq("id", parsed.data.id)
      .eq("farm_id", result.farmId)
      .select("id")
      .maybeSingle(),
    SUPABASE_READ_TIMEOUT_MS,
    null,
  );
  if (!deleteResult) return taskWriteTimeout("eliminar la tarea");
  const { data: deleted, error } = deleteResult;

  if (error && isMissingTasksTable(error)) return NextResponse.json({ error: "Aplicá la migración 014_tasks.sql para activar la agenda." }, { status: 503 });
  if (error) return databaseFailure("tasks DELETE", error);
  if (!deleted) return NextResponse.json({ error: "Tarea no encontrada" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
