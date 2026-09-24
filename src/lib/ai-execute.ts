// Executes model-proposed database operations against the allowlisted tables.
import { getSupabaseAdmin } from "./supabase";
import { computeCattleSplit } from "./cattle";
import { validateFarmRelations, validateFarmSectionConsistency } from "./auth";
import { farmLocalToday, isValidDateOnly } from "./date";
import { normalizeAICalendarDates, stripDisallowedColumns, validateAIOperation, validateAIOperationMatch } from "./ai-validation";
import { withTimeout } from "./timeout";
import type { AIOperation } from "./ai-operation";

const AI_OPERATION_TIMEOUT_MS = 4_000;
export const AI_OPERATIONS_BUDGET_MS = 12_000;

class AIOperationTimeout extends Error {
  constructor() {
    super("AI operation timed out");
    this.name = "AIOperationTimeout";
  }
}

const AI_MUTABLE_TABLES = new Set([
  "sections",
  "cattle",
  "activities",
  "vaccinations",
  "health_events",
  "crops",
  "crop_applications",
  "inventory_items",
  "inventory_movements",
  "financial_transactions",
  "tasks",
  "weight_records",
]);

const AI_MUTABLE_ACTIONS = new Set(["insert", "update", "delete", "move"]);

// Tables the generic update/delete branches in executeOperations reach
// (inventory_movements and weight_records are insert-only, and cattle
// "move" goes through its own atomic RPC) -- exactly the 10 tables
// migration 043 gave an updated_at column and a BEFORE UPDATE trigger to.
// Kept in sync with that migration: adding an updated_at-tracked table
// there without adding it here would silently skip the staleness check.
// apply_ai_operations (051) keeps the same list as c_update_tables.
export const AI_UPDATED_AT_TABLES = new Set([
  "sections",
  "cattle",
  "activities",
  "vaccinations",
  "health_events",
  "crops",
  "crop_applications",
  "inventory_items",
  "financial_transactions",
  "tasks",
]);

const AI_RELATION_FIELDS: Record<string, Array<{ field: string; table: "sections" | "crops" | "cattle" | "inventory_movements" | "inventory_items" }>> = {
  cattle: [{ field: "section_id", table: "sections" }],
  vaccinations: [
    { field: "cattle_id", table: "cattle" },
    { field: "section_id", table: "sections" },
  ],
  health_events: [
    { field: "cattle_id", table: "cattle" },
    { field: "section_id", table: "sections" },
  ],
  crops: [{ field: "section_id", table: "sections" }],
  crop_applications: [{ field: "crop_id", table: "crops" }],
  inventory_movements: [
    { field: "item_id", table: "inventory_items" },
    { field: "section_id", table: "sections" },
    { field: "crop_id", table: "crops" },
    { field: "cattle_id", table: "cattle" },
  ],
  financial_transactions: [
    { field: "section_id", table: "sections" },
    { field: "crop_id", table: "crops" },
    { field: "cattle_id", table: "cattle" },
    { field: "inventory_movement_id", table: "inventory_movements" },
  ],
  tasks: [
    { field: "section_id", table: "sections" },
    { field: "crop_id", table: "crops" },
    { field: "cattle_id", table: "cattle" },
  ],
  weight_records: [{ field: "cattle_id", table: "cattle" }],
};

const NEW_SECTION_PREFIX = "NEW_SECTION_";
const TIMEOUT_LOG = "Error: se agotó el tiempo para aplicar los cambios del asistente; reintentá el mensaje.";
const STALE_SUFFIX = "el registro cambió desde que se propuso este cambio; pedí la propuesta de nuevo.";

/** An operation that passed every check and only needs to be written. The
 * same shape feeds the atomic RPC (as JSON) and the sequential fallback. */
export type PreparedOperation =
  | { kind: "insert"; table: string; data: Record<string, unknown>; placeholder?: string }
  | { kind: "update"; table: string; id: string; data: Record<string, unknown>; expectedUpdatedAt: string }
  | { kind: "delete"; table: string; id: string; expectedUpdatedAt: string }
  | { kind: "move"; sourceId: string; destinationSectionId: string; moveCount: number; idempotencyKey: string | null }
  | { kind: "weight"; cattleId: string; date: string; weightKg: number; notes: string | null }
  | {
    kind: "purchase";
    itemId: string;
    quantity: number;
    unitCost: number;
    currency: string;
    date: string;
    sectionId: string | null;
    cropId: string | null;
    cattleId: string | null;
    notes: string | null;
  };

type PrepareResult = { ok: true; prepared: PreparedOperation } | { ok: false; log: string };

interface ExecutionContext {
  farmId: string;
  requestId?: string | null;
  deadline: number;
  dbOperation: <T>(operation: PromiseLike<T>) => Promise<T>;
}

function textOrNull(value: unknown): string | null {
  return value == null || value === "" ? null : String(value);
}

/** Every check executeOperations has always made, run before anything is
 * written. Placeholders naming a section inserted earlier in this batch stay
 * as strings (the write step resolves them) and skip the relation lookup:
 * the row does not exist yet, and it is created with this farm's id. */
async function prepareOperation(
  ctx: ExecutionContext,
  op: AIOperation,
  opIndex: number,
  batchPlaceholders: Set<string>,
): Promise<PrepareResult> {
  const db = getSupabaseAdmin();
  const { farmId, deadline, dbOperation } = ctx;
  // The model is untrusted input. Keep the executor narrower than the
  // database client so prompt injection cannot select arbitrary tables or
  // use an unscoped action such as upsert.
  if (!AI_MUTABLE_TABLES.has(op.table) || !AI_MUTABLE_ACTIONS.has(op.action)) {
    return { ok: false, log: `Error: unsupported AI operation ${op.action} on ${op.table}` };
  }
  // "move" only has a handler for cattle (batch splitting). AI_MUTABLE_ACTIONS
  // lists it as generically valid, but no other table has move semantics.
  if (op.action === "move" && op.table !== "cattle") {
    return { ok: false, log: `Error: move is only supported for cattle, not ${op.table}` };
  }

  const data = { ...op.data };
  const match = op.match ? { ...op.match } : undefined;

  // Defense in depth: drop any field not on this table's allowlist
  // before it can reach the DB, even though every listed field below is
  // separately type/enum/bounds-checked.
  const allowedData = stripDisallowedColumns(op.table, data);
  for (const key of Object.keys(data)) if (!(key in allowedData)) delete data[key];
  normalizeAICalendarDates(op.table, data);

  delete data.id;
  delete data.farm_id;
  delete data.created_at;
  delete data.updated_at;
  if (op.table === "tasks") delete data.completed_at;

  const matchValidationError = validateAIOperationMatch(op.action, match);
  if (matchValidationError) {
    return { ok: false, log: `Error: invalid AI target for ${op.table}: ${matchValidationError}` };
  }

  if (op.table === "tasks") {
    if (typeof data.title === "string") data.title = data.title.trim();
    if (op.action === "insert" && (!data.title || typeof data.title !== "string")) {
      return { ok: false, log: "Error inserting task: title is required" };
    }
    if (data.priority != null && !["low", "medium", "high"].includes(String(data.priority))) {
      return { ok: false, log: "Error inserting task: invalid priority" };
    }
    if (data.status != null && !["pending", "completed"].includes(String(data.status))) {
      return { ok: false, log: "Error updating task: invalid status" };
    }
    if (data.due_date != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(data.due_date))) {
      return { ok: false, log: "Error on task: due_date must be YYYY-MM-DD" };
    }
    if (data.status === "completed") data.completed_at = new Date().toISOString();
    if (data.status === "pending" && op.action === "update") data.completed_at = null;
  }

  // Inventory movements have side effects on stock and, for purchases,
  // on financials. Never let the generic table executor bypass the
  // dedicated invariants used by /api/inventory/movements.
  if (op.table === "inventory_movements" && op.action !== "insert") {
    return { ok: false, log: "Error: inventory movements can only be inserted through the validated movement flow" };
  }
  if (op.table === "inventory_items" && op.action === "update" && Object.prototype.hasOwnProperty.call(data, "current_stock")) {
    return { ok: false, log: "Error: update stock through an inventory movement, not by editing the item directly" };
  }
  if (op.table === "financial_transactions" && op.action === "insert" && data.category === "compra_insumo") {
    return { ok: false, log: "Error: register supply purchases through inventory_movements so stock and finance stay linked" };
  }
  if (op.table === "financial_transactions" && (op.action === "update" || op.action === "delete") && typeof match?.id === "string") {
    const { data: linked, error: linkError } = await dbOperation(db
      .from("financial_transactions")
      .select("inventory_movement_id")
      .eq("id", match.id)
      .eq("farm_id", farmId)
      .maybeSingle());
    if (linkError) return { ok: false, log: `Error checking financial link: ${linkError.message}` };
    if (linked?.inventory_movement_id) {
      return {
        ok: false,
        log: op.action === "update"
          ? "Error: financial entries linked to inventory purchases are managed from inventory"
          : "Error: linked inventory purchase entries cannot be deleted separately",
      };
    }
  }
  const aiValidationError = validateAIOperation(op.table, op.action, data);
  if (aiValidationError) {
    return { ok: false, log: `Error: invalid AI data for ${op.table}: ${aiValidationError}` };
  }

  const relationCheck = await withTimeout(validateFarmRelations(
    farmId,
    (AI_RELATION_FIELDS[op.table] || [])
      .filter(({ field, table }) => !(table === "sections" && typeof data[field] === "string" && batchPlaceholders.has(data[field] as string)))
      .map(({ field, table }) => ({ table, id: data[field] })),
  ), Math.max(1, Math.min(2_500, deadline - Date.now())), null);
  if (!relationCheck) throw new AIOperationTimeout();
  if (!relationCheck.ok) {
    return {
      ok: false,
      log: `Error: AI reference ${relationCheck.table} ${relationCheck.unavailable ? "could not be validated" : "does not belong to this farm"}`,
    };
  }

  if (op.table === "weight_records") {
    if (op.action !== "insert") {
      return { ok: false, log: "Error: los pesajes solo se pueden registrar con action insert" };
    }
    const cattleId = data.cattle_id;
    const weightKg = Number(data.weight_kg);
    const weightDate = data.date == null || data.date === "" ? farmLocalToday(Date.now()) : data.date;
    if (typeof cattleId !== "string" || !cattleId || !Number.isFinite(weightKg) || weightKg <= 0 || typeof weightDate !== "string" || !isValidDateOnly(weightDate)) {
      return { ok: false, log: "Error inserting weight record: cattle_id, weight_kg and a valid date are required" };
    }
    return { ok: true, prepared: { kind: "weight", cattleId, date: weightDate, weightKg, notes: textOrNull(data.notes) } };
  }

  if (op.table === "inventory_movements") {
    const movementType = String(data.type || "");
    const movementTypes = new Set(["compra", "uso", "ajuste", "pérdida"]);
    const itemId = data.item_id;
    const quantity = Number(data.quantity);
    const unitCost = data.unit_cost == null || data.unit_cost === "" ? null : Number(data.unit_cost);
    const movementDate = data.date == null || data.date === "" ? farmLocalToday(Date.now()) : data.date;
    if (typeof itemId !== "string" || !itemId || !movementTypes.has(movementType)) {
      return { ok: false, log: "Error inserting inventory movement: item_id and a valid type are required" };
    }
    if (!Number.isFinite(quantity) || quantity === 0 || (movementType === "compra" && quantity < 0) || ((movementType === "uso" || movementType === "pérdida") && quantity > 0)) {
      return { ok: false, log: "Error inserting inventory movement: invalid quantity for movement type" };
    }
    if (unitCost !== null && (!Number.isFinite(unitCost) || unitCost < 0)) {
      return { ok: false, log: "Error inserting inventory movement: invalid unit cost" };
    }
    if (typeof movementDate !== "string" || !isValidDateOnly(movementDate)) {
      return { ok: false, log: "Error inserting inventory movement: date must use YYYY-MM-DD" };
    }
    const { data: item, error: itemError } = await dbOperation(db
      .from("inventory_items")
      .select("current_stock, name, currency")
      .eq("id", itemId)
      .eq("farm_id", farmId)
      .maybeSingle());
    if (itemError || !item) {
      return { ok: false, log: `Error inserting inventory movement: item not found (${itemId})` };
    }
    const sectionValidation = await withTimeout(validateFarmSectionConsistency(farmId, data.section_id, [
      { table: "crops", id: data.crop_id, label: "el cultivo" },
      { table: "cattle", id: data.cattle_id, label: "la hacienda" },
    ]), Math.max(1, Math.min(2_500, deadline - Date.now())), null);
    if (!sectionValidation) throw new AIOperationTimeout();
    if (!sectionValidation.ok) {
      return { ok: false, log: "Error inserting inventory movement: section does not match the selected relation" };
    }
    // Checked against the stock before the batch; two movements on the same
    // item are re-checked by the non-negative stock constraint (033).
    if (Number(item.current_stock) + quantity < 0) {
      return { ok: false, log: "Error inserting inventory movement: insufficient stock" };
    }
    const currency = String(data.currency || item.currency || "USD");
    if (!new Set(["USD", "UYU", "ARS"]).has(currency)) {
      return { ok: false, log: "Error inserting inventory movement: invalid currency" };
    }
    if (movementType === "compra" && unitCost !== null && unitCost > 0) {
      return {
        ok: true,
        prepared: {
          kind: "purchase",
          itemId,
          quantity,
          unitCost,
          currency,
          date: movementDate,
          sectionId: textOrNull(data.section_id),
          cropId: textOrNull(data.crop_id),
          cattleId: textOrNull(data.cattle_id),
          notes: textOrNull(data.notes),
        },
      };
    }
    return {
      ok: true,
      prepared: {
        kind: "insert",
        table: "inventory_movements",
        data: {
          item_id: itemId,
          type: movementType,
          quantity,
          unit_cost: unitCost,
          currency,
          section_id: data.section_id || null,
          crop_id: data.crop_id || null,
          cattle_id: data.cattle_id || null,
          date: movementDate,
          notes: data.notes || null,
        },
      },
    };
  }

  if (op.action === "move") {
    const moveCount = op.move_count || 0;
    const destinationSectionId = data.section_id;
    if (typeof destinationSectionId !== "string" || !destinationSectionId || !moveCount) {
      return { ok: false, log: "Error moving cattle: missing section_id or move_count" };
    }
    return {
      ok: true,
      prepared: {
        kind: "move",
        sourceId: String(match!.id),
        destinationSectionId,
        moveCount,
        // Scoped per operation within the batch so a client retry of the
        // whole request (same Idempotency-Key) replays this exact move
        // instead of splitting the batch again.
        idempotencyKey: ctx.requestId ? `${ctx.requestId}:move:${opIndex}` : null,
      },
    };
  }

  if (op.action === "insert") {
    const placeholder = op.table === "sections" ? `${NEW_SECTION_PREFIX}${data.name}` : undefined;
    return { ok: true, prepared: { kind: "insert", table: op.table, data, ...(placeholder ? { placeholder } : {}) } };
  }

  const verb = op.action === "update" ? "Error updating" : "Error deleting from";
  if (typeof op.expectedUpdatedAt !== "string" || !AI_UPDATED_AT_TABLES.has(op.table)) {
    return { ok: false, log: `${verb} ${op.table}: falta la marca de tiempo esperada; pedí la propuesta de nuevo.` };
  }

  if (op.action === "delete" && op.table === "inventory_items") {
    const { data: history, error: historyError } = await dbOperation(db
      .from("inventory_movements")
      .select("id")
      .eq("item_id", match!.id)
      .eq("farm_id", farmId)
      .limit(1)
      .maybeSingle());
    if (historyError) return { ok: false, log: `Error checking inventory history: ${historyError.message}` };
    if (history) return { ok: false, log: "Error: inventory items with movement history cannot be deleted" };
  }

  if (op.action === "update") {
    return { ok: true, prepared: { kind: "update", table: op.table, id: String(match!.id), data, expectedUpdatedAt: op.expectedUpdatedAt } };
  }
  return { ok: true, prepared: { kind: "delete", table: op.table, id: String(match!.id), expectedUpdatedAt: op.expectedUpdatedAt } };
}

function successLog(prepared: PreparedOperation, result?: { move_mode?: unknown; moved_count?: unknown }): string {
  switch (prepared.kind) {
    case "insert":
      return prepared.table === "inventory_movements" ? "Inserted inventory movement: OK" : `Inserted into ${prepared.table}: OK`;
    case "update":
      return `Updated ${prepared.table}: OK`;
    case "delete":
      return `Deleted from ${prepared.table}: OK`;
    case "weight":
      return "Inserted weight record and synchronized cattle weight: OK";
    case "purchase":
      return "Inserted inventory purchase and financial entry: OK";
    case "move": {
      const mode = result?.move_mode;
      const moved = result?.moved_count;
      if (mode === "noop") return "El lote ya estaba en la sección destino; no hubo cambios.";
      if (mode === "all") return `Moved all ${moved} heads to new section: OK`;
      if (mode === "split") return `Moved ${moved} heads to new section: OK (atomic split)`;
      return `Error moving cattle: transactional move returned unknown mode ${String(mode)}`;
    }
  }
}

function failureLog(prepared: PreparedOperation, message: string, reason: string | undefined): string {
  if (reason === "stale" && (prepared.kind === "update" || prepared.kind === "delete")) {
    return `${prepared.kind === "update" ? "Error updating" : "Error deleting from"} ${prepared.table}: ${STALE_SUFFIX}`;
  }
  switch (prepared.kind) {
    case "insert":
      return prepared.table === "inventory_movements"
        ? `Error inserting inventory movement: ${message}`
        : `Error inserting into ${prepared.table}: ${message}`;
    case "update":
      return `Error updating ${prepared.table}: ${message}`;
    case "delete":
      return `Error deleting from ${prepared.table}: ${message}`;
    case "move":
      return `Error moving cattle: ${message}`;
    case "weight":
      return `Error inserting weight record: ${message}`;
    case "purchase":
      return `Error inserting inventory purchase: ${message}`;
  }
}

function describeOperation(op: AIOperation): string {
  return `${op.action} ${op.table}`;
}

/** Logged for every operation of a batch that was not written because
 * another one failed. The whole batch is all-or-nothing. */
function notAppliedLog(op: AIOperation): string {
  return `Error: no se aplicó ${describeOperation(op)} porque otra operación del lote falló; no se guardó ningún cambio de esta propuesta.`;
}

const RPC_UNAVAILABLE_CODES = new Set([
  "PGRST202", // PostgREST: function not in the schema cache (migration 051 not applied)
  "42883", // Postgres undefined_function (e.g. a helper it calls is missing)
]);

type RPCError = { code?: string; message?: string; details?: string | null; hint?: string | null };

function failedOpIndex(error: RPCError): number | null {
  if (!error.details) return null;
  try {
    const parsed = JSON.parse(error.details) as { op_index?: unknown };
    return typeof parsed.op_index === "number" && parsed.op_index >= 0 ? parsed.op_index : null;
  } catch {
    return null;
  }
}

/** Map apply_ai_operations' outcome back to one log line per operation, in
 * the same wording the sequential executor has always used. Exported for
 * tests. */
export function logsFromAtomicResult(
  operations: AIOperation[],
  prepared: PreparedOperation[],
  outcome: { data: unknown; error: RPCError | null },
): string[] {
  const { data, error } = outcome;
  if (error) {
    if (error.code === "40P01" || error.code === "40001") {
      return [
        "Error: otro cambio simultáneo en el campo se cruzó con esta propuesta; no se guardó ningún cambio, reintentá el mensaje.",
        ...operations.map(notAppliedLog),
      ];
    }
    const index = failedOpIndex(error);
    const message = error.message || "transaction failed";
    if (index === null || index >= prepared.length) {
      return [`Error: no se pudieron aplicar los cambios del asistente: ${message}`, ...operations.map(notAppliedLog)];
    }
    return operations.map((op, i) => (i === index ? failureLog(prepared[i], message, error.hint ?? undefined) : notAppliedLog(op)));
  }
  const results = (data && typeof data === "object" && Array.isArray((data as { results?: unknown }).results))
    ? (data as { results: Array<Record<string, unknown>> }).results
    : null;
  if (!results) {
    return ["Error: apply_ai_operations returned an invalid result"];
  }
  return prepared.map((op, i) => {
    const result = results.find((row) => row.index === i);
    return result ? successLog(op, result) : "Error: apply_ai_operations returned no result for this operation";
  });
}

function toRPCOperation(prepared: PreparedOperation): Record<string, unknown> {
  switch (prepared.kind) {
    case "insert":
      return { kind: "insert", table: prepared.table, data: prepared.data, ...(prepared.placeholder ? { placeholder: prepared.placeholder } : {}) };
    case "update":
      return { kind: "update", table: prepared.table, id: prepared.id, data: prepared.data, expected_updated_at: prepared.expectedUpdatedAt };
    case "delete":
      return { kind: "delete", table: prepared.table, id: prepared.id, expected_updated_at: prepared.expectedUpdatedAt };
    case "move":
      return {
        kind: "move",
        source_id: prepared.sourceId,
        destination_section_id: prepared.destinationSectionId,
        move_count: prepared.moveCount,
        idempotency_key: prepared.idempotencyKey,
      };
    case "weight":
      return { kind: "weight", cattle_id: prepared.cattleId, date: prepared.date, weight_kg: prepared.weightKg, notes: prepared.notes };
    case "purchase":
      return {
        kind: "purchase",
        item_id: prepared.itemId,
        quantity: prepared.quantity,
        unit_cost: prepared.unitCost,
        currency: prepared.currency,
        date: prepared.date,
        section_id: prepared.sectionId,
        crop_id: prepared.cropId,
        cattle_id: prepared.cattleId,
        notes: prepared.notes,
      };
  }
}

/** Replace placeholders with the ids of sections created earlier in the batch. */
function resolvePlaceholders<T extends Record<string, unknown>>(values: T, newSectionIds: Record<string, string>): T {
  const resolved: Record<string, unknown> = { ...values };
  for (const [key, value] of Object.entries(resolved)) {
    if (typeof value === "string" && value.startsWith(NEW_SECTION_PREFIX) && newSectionIds[value]) resolved[key] = newSectionIds[value];
  }
  return resolved as T;
}

/** Pre-051 path: one PostgREST call per operation. Used only when
 * apply_ai_operations is not deployed, so it is not atomic across ops. */
async function applySequentially(ctx: ExecutionContext, preparedOps: PreparedOperation[]): Promise<string[]> {
  const db = getSupabaseAdmin();
  const { farmId, dbOperation } = ctx;
  const logs: string[] = [];
  const newSectionIds: Record<string, string> = {};

  for (const original of preparedOps) {
    if (Date.now() >= ctx.deadline) {
      logs.push(TIMEOUT_LOG);
      break;
    }
    try {
      const prepared = resolvePlaceholders(original as unknown as Record<string, unknown>, newSectionIds) as unknown as PreparedOperation;
      if (prepared.kind === "weight") {
        const { data: recordId, error: rpcError } = await dbOperation(db.rpc("record_weight", {
          p_farm_id: farmId,
          p_cattle_id: prepared.cattleId,
          p_date: prepared.date,
          p_weight_kg: prepared.weightKg,
          p_notes: prepared.notes,
        }));
        if (rpcError || !recordId) {
          logs.push(rpcError?.code === "PGRST202"
            ? "Error: aplicá supabase/010_integrity.sql antes de registrar pesajes desde CampoAI"
            : `Error inserting weight record: ${rpcError?.message || "transaction unavailable"}`);
        } else {
          logs.push(successLog(prepared));
        }
        continue;
      }

      if (prepared.kind === "purchase") {
        const { data: movementId, error: rpcError } = await dbOperation(db.rpc("record_inventory_purchase", {
          p_farm_id: farmId,
          p_item_id: prepared.itemId,
          p_quantity: prepared.quantity,
          p_unit_cost: prepared.unitCost,
          p_section_id: prepared.sectionId,
          p_crop_id: prepared.cropId,
          p_cattle_id: prepared.cattleId,
          p_date: prepared.date,
          p_notes: prepared.notes,
          p_currency: prepared.currency,
        }));
        if (rpcError || !movementId) {
          logs.push(rpcError?.code === "PGRST202"
            ? "Error: apply supabase/010_integrity.sql before recording a purchase with cost"
            : `Error inserting inventory purchase: ${rpcError?.message || "transaction unavailable"}`);
        } else {
          logs.push(successLog(prepared));
        }
        continue;
      }

      if (prepared.kind === "move") {
        logs.push(await moveSequentially(ctx, prepared));
        continue;
      }

      if (prepared.kind === "insert") {
        const data: Record<string, unknown> = { ...resolvePlaceholders(prepared.data, newSectionIds), farm_id: farmId };
        let result = await dbOperation(db.from(prepared.table).insert(data).select().single());
        if (prepared.table === "inventory_movements" && result.error?.code === "PGRST204") {
          const { currency: _currency, ...legacyPayload } = data;
          void _currency;
          result = await dbOperation(db.from(prepared.table).insert(legacyPayload).select().single());
        }
        if (result.error) {
          logs.push(failureLog(prepared, result.error.message, undefined));
        } else {
          logs.push(successLog(prepared));
          const inserted = result.data as { id?: string } | null;
          if (prepared.placeholder && inserted?.id) newSectionIds[prepared.placeholder] = inserted.id;
        }
        continue;
      }

      // Optimistic concurrency: only apply if the row still has the
      // updated_at snapshotted when the proposal was confirmed, so a
      // stale confirmation can't silently overwrite a since-changed row.
      const base = prepared.kind === "update"
        ? db.from(prepared.table).update(resolvePlaceholders(prepared.data, newSectionIds))
        : db.from(prepared.table).delete();
      const query = base
        .eq("farm_id", farmId)
        .eq("id", prepared.id)
        .eq("updated_at", prepared.expectedUpdatedAt);
      const { data: rows, error } = await dbOperation(query.select("id"));
      if (error) logs.push(failureLog(prepared, error.message, undefined));
      else if (!rows || rows.length === 0) logs.push(failureLog(prepared, "", "stale"));
      else logs.push(successLog(prepared));
    } catch (e) {
      if (e instanceof AIOperationTimeout) {
        logs.push(TIMEOUT_LOG);
        break;
      }
      logs.push(`Exception on ${"table" in original ? original.table : original.kind}: ${e}`);
    }
  }
  return logs;
}

async function moveSequentially(ctx: ExecutionContext, move: Extract<PreparedOperation, { kind: "move" }>): Promise<string> {
  const db = getSupabaseAdmin();
  const { farmId, dbOperation } = ctx;
  // Prefer the Postgres transaction so a partial move cannot leave the
  // source batch reduced without a destination batch. Older databases
  // can still use the compatibility path below until migration 021 is
  // applied.
  const { data: transactionalMove, error: transactionalMoveError } = await dbOperation(db
    .rpc("move_cattle", {
      p_farm_id: farmId,
      p_source_cattle_id: move.sourceId,
      p_destination_section_id: move.destinationSectionId,
      p_move_count: move.moveCount,
      p_idempotency_key: move.idempotencyKey,
    })
    .single());
  const atomicMove = transactionalMove as { move_mode?: string; moved_count?: number } | null;
  const moveFunctionMissing = transactionalMoveError?.code === "PGRST202";
  if (!transactionalMoveError) {
    if (!atomicMove || typeof atomicMove.move_mode !== "string" || typeof atomicMove.moved_count !== "number") {
      return "Error moving cattle: transactional move returned an invalid result";
    }
    return successLog(move, atomicMove);
  }
  if (!moveFunctionMissing) return `Error moving cattle: ${transactionalMoveError.message}`;

  const { data: destination, error: destinationErr } = await dbOperation(db
    .from("sections")
    .select("id")
    .eq("id", move.destinationSectionId)
    .eq("farm_id", farmId)
    .single());
  if (destinationErr || !destination) return `Error moving cattle: destination section not found (${move.destinationSectionId})`;

  const { data: source, error: fetchErr } = await dbOperation(db
    .from("cattle")
    .select("*")
    .eq("id", move.sourceId)
    .eq("farm_id", farmId)
    .single());
  if (fetchErr || !source) return `Error moving cattle: source record not found (${move.sourceId})`;

  const split = computeCattleSplit(source.count, move.moveCount);
  if (split.mode === "invalid") return `Error moving cattle: ${split.reason}`;
  if (split.mode === "split") {
    return "Error moving cattle: aplicá supabase/021_cattle_move_transaction.sql para dividir lotes de forma segura";
  }
  // Move the entire batch — just update section_id
  const { error } = await dbOperation(db
    .from("cattle")
    .update({ section_id: move.destinationSectionId })
    .eq("id", source.id)
    .eq("farm_id", farmId));
  return error ? `Error moving cattle: ${error.message}` : `Moved all ${source.count} ${source.category} to new section: OK`;
}

/** Apply a confirmed AI proposal.
 *
 * 1. Every operation is validated first (allowlists, relations, stock, links,
 *    the expectedUpdatedAt anchor). If any fails, nothing is written.
 * 2. The prepared batch goes to apply_ai_operations (051) and commits as one
 *    transaction; a failure in op N rolls back ops 0..N-1 too.
 * 3. Databases without 051 fall back to the old one-call-per-op writes.
 *
 * Returns one log line per operation ("... OK" or "Error ..."). */
export async function executeOperations(
  farmId: string,
  operations: AIOperation[],
  budgetMs = AI_OPERATIONS_BUDGET_MS,
  requestId?: string | null,
): Promise<string[]> {
  const deadline = Date.now() + Math.max(1, budgetMs);
  const dbOperation = async <T>(operation: PromiseLike<T>): Promise<T> => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new AIOperationTimeout();
    const result = await withTimeout(operation, Math.min(AI_OPERATION_TIMEOUT_MS, remaining), null);
    if (result === null) throw new AIOperationTimeout();
    return result;
  };
  const ctx: ExecutionContext = { farmId, requestId, deadline, dbOperation };

  const candidateOperations = Array.isArray(operations) ? operations.slice(0, 20) : [];
  if (candidateOperations.length === 0) return [];

  const prepared: PreparedOperation[] = [];
  const batchPlaceholders = new Set<string>();
  for (const [opIndex, op] of candidateOperations.entries()) {
    let outcome: PrepareResult;
    try {
      if (Date.now() >= deadline) throw new AIOperationTimeout();
      outcome = await prepareOperation(ctx, op, opIndex, batchPlaceholders);
    } catch (e) {
      outcome = { ok: false, log: e instanceof AIOperationTimeout ? TIMEOUT_LOG : `Exception on ${op.table}: ${e}` };
    }
    if (!outcome.ok) {
      // All-or-nothing: an invalid operation keeps the whole proposal unapplied.
      return candidateOperations.map((other, i) => (i === opIndex ? outcome.log : notAppliedLog(other)));
    }
    if (outcome.prepared.kind === "insert" && outcome.prepared.placeholder) batchPlaceholders.add(outcome.prepared.placeholder);
    prepared.push(outcome.prepared);
  }

  const remaining = deadline - Date.now();
  if (remaining <= 0) return [TIMEOUT_LOG, ...candidateOperations.map(notAppliedLog)];
  const db = getSupabaseAdmin();
  const outcome = await withTimeout(
    db.rpc("apply_ai_operations", {
      p_farm_id: farmId,
      p_ops: prepared.map(toRPCOperation),
      // A retry of the same request replays the committed result instead of
      // writing the batch twice.
      p_idempotency_key: requestId ? `ai-batch:${requestId}` : null,
    }),
    remaining,
    null,
  );
  if (!outcome) {
    // The transaction may still commit after we stop waiting. A retry with
    // the same request id replays it instead of applying it again.
    return [TIMEOUT_LOG];
  }
  if (outcome.error && RPC_UNAVAILABLE_CODES.has(outcome.error.code ?? "")) {
    return applySequentially(ctx, prepared);
  }
  return logsFromAtomicResult(candidateOperations, prepared, outcome);
}
