// Executes model-proposed database operations against the allowlisted tables.
import { getSupabaseAdmin } from "./supabase";
import { computeCattleSplit } from "./cattle";
import { validateFarmRelations, validateFarmSectionConsistency } from "./auth";
import { farmLocalToday, isValidDateOnly } from "./date";
import { normalizeAICalendarDates, stripDisallowedColumns, validateAIOperation, validateAIOperationMatch } from "./ai-validation";
import { withTimeout } from "./timeout";
import { type AIOperation } from "./ai-operation";

const AI_OPERATION_TIMEOUT_MS = 4_000;
const AI_OPERATIONS_BUDGET_MS = 12_000;

class AIOperationTimeout extends Error {
  constructor() {
    super("AI operation timed out");
    this.name = "AIOperationTimeout";
  }
}

type DBOperation = AIOperation;

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

// Execute the DB operations returned by AI
export async function executeOperations(
  farmId: string,
  operations: DBOperation[],
  budgetMs = AI_OPERATIONS_BUDGET_MS,
  requestId?: string | null,
): Promise<string[]> {
  const db = getSupabaseAdmin();
  const logs: string[] = [];
  const newSectionIds: Record<string, string> = {};
  const deadline = Date.now() + Math.max(1, budgetMs);
  const dbOperation = async <T>(operation: PromiseLike<T>): Promise<T> => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new AIOperationTimeout();
    const result = await withTimeout(operation, Math.min(AI_OPERATION_TIMEOUT_MS, remaining), null);
    if (result === null) throw new AIOperationTimeout();
    return result;
  };

  const candidateOperations = Array.isArray(operations) ? operations.slice(0, 20) : [];
  for (const [opIndex, op] of candidateOperations.entries()) {
    if (Date.now() >= deadline) {
      logs.push("Error: se agotó el tiempo para aplicar los cambios del asistente; reintentá el mensaje.");
      break;
    }
    try {
      // The model is untrusted input. Keep the executor narrower than the
      // database client so prompt injection cannot select arbitrary tables or
      // use an unscoped action such as upsert.
      if (!AI_MUTABLE_TABLES.has(op.table) || !AI_MUTABLE_ACTIONS.has(op.action)) {
        logs.push(`Error: unsupported AI operation ${op.action} on ${op.table}`);
        continue;
      }
      // "move" only has a handler for cattle (batch splitting). On any other
      // table it previously fell through every branch below silently —
      // AI_MUTABLE_ACTIONS lists it as generically valid, but no other table
      // has move semantics to execute.
      if (op.action === "move" && op.table !== "cattle") {
        logs.push(`Error: move is only supported for cattle, not ${op.table}`);
        continue;
      }

      // Replace NEW_SECTION_ placeholders with real IDs
      const data = { ...op.data };
      const match = op.match ? { ...op.match } : undefined;

      for (const [key, val] of Object.entries(data)) {
        if (typeof val === "string" && val.startsWith("NEW_SECTION_")) {
          const realId = newSectionIds[val];
          if (realId) data[key] = realId;
        }
      }

      if (match) {
        for (const [key, val] of Object.entries(match)) {
          if (typeof val === "string" && val.startsWith("NEW_SECTION_")) {
            const realId = newSectionIds[val];
            if (realId) match[key] = realId;
          }
        }
      }

      // Defense in depth: drop any field not on this table's allowlist
      // before it can reach the DB, even though every listed field below is
      // separately type/enum/bounds-checked.
      const allowedData = stripDisallowedColumns(op.table, data);
      for (const key of Object.keys(data)) if (!(key in allowedData)) delete data[key];
      normalizeAICalendarDates(op.table, data);

      // Ensure farm_id is set for inserts
      delete data.id;
      delete data.farm_id;
      delete data.created_at;
      delete data.updated_at;
      if (op.table === "tasks") delete data.completed_at;
      if (op.action === "insert" && ["sections", "cattle", "activities", "vaccinations", "health_events", "crops", "crop_applications", "inventory_items", "inventory_movements", "financial_transactions", "tasks", "weight_records"].includes(op.table)) {
        data.farm_id = farmId;
      }

      const matchValidationError = validateAIOperationMatch(op.action, match);
      if (matchValidationError) {
        logs.push(`Error: invalid AI target for ${op.table}: ${matchValidationError}`);
        continue;
      }

      if (op.table === "tasks") {
        if (typeof data.title === "string") data.title = data.title.trim();
        if (op.action === "insert" && (!data.title || typeof data.title !== "string")) {
          logs.push("Error inserting task: title is required");
          continue;
        }
        if (data.priority != null && !["low", "medium", "high"].includes(String(data.priority))) {
          logs.push("Error inserting task: invalid priority");
          continue;
        }
        if (data.status != null && !["pending", "completed"].includes(String(data.status))) {
          logs.push("Error updating task: invalid status");
          continue;
        }
        if (data.due_date != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(data.due_date))) {
          logs.push("Error on task: due_date must be YYYY-MM-DD");
          continue;
        }
        if (data.status === "completed") data.completed_at = new Date().toISOString();
        if (data.status === "pending" && op.action === "update") data.completed_at = null;
      }

      // Inventory movements have side effects on stock and, for purchases,
      // on financials. Never let the generic table executor bypass the
      // dedicated invariants used by /api/inventory/movements.
      if (op.table === "inventory_movements" && op.action !== "insert") {
        logs.push("Error: inventory movements can only be inserted through the validated movement flow");
        continue;
      }
      if (op.table === "inventory_items" && op.action === "update" && Object.prototype.hasOwnProperty.call(data, "current_stock")) {
        logs.push("Error: update stock through an inventory movement, not by editing the item directly");
        continue;
      }
      if (op.table === "financial_transactions" && op.action === "insert" && data.category === "compra_insumo") {
        logs.push("Error: register supply purchases through inventory_movements so stock and finance stay linked");
        continue;
      }
      if (op.table === "financial_transactions" && op.action === "update") {
        if (typeof match?.id === "string") {
          const { data: linked, error: linkError } = await dbOperation(db
            .from("financial_transactions")
            .select("inventory_movement_id")
            .eq("id", match.id)
            .eq("farm_id", farmId)
            .maybeSingle());
          if (linkError) {
            logs.push(`Error checking financial link: ${linkError.message}`);
            continue;
          }
          if (linked?.inventory_movement_id) {
            logs.push("Error: financial entries linked to inventory purchases are managed from inventory");
            continue;
          }
        }
      }
      const aiValidationError = validateAIOperation(op.table, op.action, data);
      if (aiValidationError) {
        logs.push(`Error: invalid AI data for ${op.table}: ${aiValidationError}`);
        continue;
      }

      const relationCheck = await withTimeout(validateFarmRelations(
        farmId,
        (AI_RELATION_FIELDS[op.table] || []).map(({ field, table }) => ({
          table,
          id: data[field],
        }))
      ), Math.max(1, Math.min(2_500, deadline - Date.now())), null);
      if (!relationCheck) {
        logs.push("Error: no se pudieron validar las referencias a tiempo; reintentá el mensaje.");
        break;
      }
      if (!relationCheck.ok) {
        logs.push(
          `Error: AI reference ${relationCheck.table} ${relationCheck.unavailable ? "could not be validated" : "does not belong to this farm"}`
        );
        continue;
      }

      if (op.table === "weight_records") {
        if (op.action !== "insert") {
          logs.push("Error: los pesajes solo se pueden registrar con action insert");
          continue;
        }
        const cattleId = data.cattle_id;
        const weightKg = Number(data.weight_kg);
        const weightDate = data.date == null || data.date === "" ? farmLocalToday(Date.now()) : data.date;
        if (typeof cattleId !== "string" || !cattleId || !Number.isFinite(weightKg) || weightKg <= 0 || typeof weightDate !== "string" || !isValidDateOnly(weightDate)) {
          logs.push("Error inserting weight record: cattle_id, weight_kg and a valid date are required");
          continue;
        }
        const { data: recordId, error: rpcError } = await dbOperation(db.rpc("record_weight", {
          p_farm_id: farmId,
          p_cattle_id: cattleId,
          p_date: weightDate,
          p_weight_kg: weightKg,
          p_notes: data.notes || null,
        }));
        if (rpcError || !recordId) {
          logs.push(rpcError?.code === "PGRST202"
            ? "Error: aplicá supabase/010_integrity.sql antes de registrar pesajes desde CampoAI"
            : `Error inserting weight record: ${rpcError?.message || "transaction unavailable"}`);
        } else {
          logs.push("Inserted weight record and synchronized cattle weight: OK");
        }
        continue;
      }

      if (op.table === "inventory_movements" && op.action === "insert") {
        const movementType = String(data.type || "");
        const movementTypes = new Set(["compra", "uso", "ajuste", "pérdida"]);
        const itemId = data.item_id;
        const quantity = Number(data.quantity);
        const unitCost = data.unit_cost == null || data.unit_cost === "" ? null : Number(data.unit_cost);
        const movementDate = data.date == null || data.date === "" ? farmLocalToday(Date.now()) : data.date;
        if (typeof itemId !== "string" || !itemId || !movementTypes.has(movementType)) {
          logs.push("Error inserting inventory movement: item_id and a valid type are required");
          continue;
        }
        if (!Number.isFinite(quantity) || quantity === 0 || (movementType === "compra" && quantity < 0) || ((movementType === "uso" || movementType === "pérdida") && quantity > 0)) {
          logs.push("Error inserting inventory movement: invalid quantity for movement type");
          continue;
        }
        if (unitCost !== null && (!Number.isFinite(unitCost) || unitCost < 0)) {
          logs.push("Error inserting inventory movement: invalid unit cost");
          continue;
        }
        if (typeof movementDate !== "string" || !isValidDateOnly(movementDate)) {
          logs.push("Error inserting inventory movement: date must use YYYY-MM-DD");
          continue;
        }
        const { data: item, error: itemError } = await dbOperation(db
          .from("inventory_items")
          .select("current_stock, name, currency")
          .eq("id", itemId)
          .eq("farm_id", farmId)
          .maybeSingle());
        if (itemError || !item) {
          logs.push(`Error inserting inventory movement: item not found (${itemId})`);
          continue;
        }
        const sectionValidation = await withTimeout(validateFarmSectionConsistency(farmId, data.section_id, [
          { table: "crops", id: data.crop_id, label: "el cultivo" },
          { table: "cattle", id: data.cattle_id, label: "la hacienda" },
        ]), Math.max(1, Math.min(2_500, deadline - Date.now())), null);
        if (!sectionValidation) {
          logs.push("Error: no se pudo validar el contexto a tiempo; reintentá el mensaje.");
          break;
        }
        if (!sectionValidation.ok) {
          logs.push("Error inserting inventory movement: section does not match the selected relation");
          continue;
        }
        if (Number(item.current_stock) + quantity < 0) {
          logs.push("Error inserting inventory movement: insufficient stock");
          continue;
        }
        const purchaseCurrency = String(data.currency || item.currency || "USD");
        if (!new Set(["USD", "UYU", "ARS"]).has(purchaseCurrency)) {
          logs.push("Error inserting inventory movement: invalid currency");
          continue;
        }
        if (movementType === "compra" && unitCost !== null && unitCost > 0) {
          const { data: movementId, error: rpcError } = await dbOperation(db.rpc("record_inventory_purchase", {
            p_farm_id: farmId,
            p_item_id: itemId,
            p_quantity: quantity,
            p_unit_cost: unitCost,
            p_section_id: data.section_id || null,
            p_crop_id: data.crop_id || null,
            p_cattle_id: data.cattle_id || null,
            p_date: movementDate,
            p_notes: data.notes || null,
            p_currency: purchaseCurrency,
          }));
          if (rpcError || !movementId) {
            logs.push(rpcError?.code === "PGRST202"
              ? "Error: apply supabase/010_integrity.sql before recording a purchase with cost"
              : `Error inserting inventory purchase: ${rpcError?.message || "transaction unavailable"}`);
          } else {
            logs.push("Inserted inventory purchase and financial entry: OK");
          }
          continue;
        }
        const movementPayload = {
          farm_id: farmId,
          item_id: itemId,
          type: movementType,
          quantity,
          unit_cost: unitCost,
          currency: purchaseCurrency,
          section_id: data.section_id || null,
          crop_id: data.crop_id || null,
          cattle_id: data.cattle_id || null,
          date: movementDate,
          notes: data.notes || null,
        };
        let movementResult = await dbOperation(db.from("inventory_movements").insert(movementPayload).select("id").single());
        if (movementResult.error?.code === "PGRST204") {
          const { currency: _currency, ...legacyPayload } = movementPayload;
          void _currency;
          movementResult = await dbOperation(db.from("inventory_movements").insert(legacyPayload).select("id").single());
        }
        if (movementResult.error) logs.push(`Error inserting inventory movement: ${movementResult.error.message}`);
        else logs.push("Inserted inventory movement: OK");
        continue;
      }

      // ── MOVE operation (split cattle batch) ──
      if (op.action === "move" && op.table === "cattle" && match?.id) {
        const moveCount = op.move_count || 0;
        const newSectionId = data.section_id;

        if (!newSectionId || !moveCount) {
          logs.push(`Error moving cattle: missing section_id or move_count`);
          continue;
        }

        // Prefer the Postgres transaction so a partial move cannot leave the
        // source batch reduced without a destination batch. Older databases
        // can still use the compatibility path below until migration 021 is
        // applied.
        const { data: transactionalMove, error: transactionalMoveError } = await dbOperation(db
          .rpc("move_cattle", {
            p_farm_id: farmId,
            p_source_cattle_id: match.id,
            p_destination_section_id: newSectionId,
            p_move_count: moveCount,
            // Scoped per operation within the batch so a client retry of the
            // whole request (same Idempotency-Key) replays this exact move
            // instead of splitting the batch again.
            p_idempotency_key: requestId ? `${requestId}:move:${opIndex}` : null,
          })
          .single());
        const atomicMove = transactionalMove as { move_mode?: string; moved_count?: number } | null;
        const moveFunctionMissing = transactionalMoveError?.code === "PGRST202";
        if (!transactionalMoveError) {
          if (!atomicMove || typeof atomicMove.move_mode !== "string" || typeof atomicMove.moved_count !== "number") {
            logs.push("Error moving cattle: transactional move returned an invalid result");
            continue;
          }
          const moveMode = atomicMove.move_mode;
          if (moveMode === "noop") {
            logs.push("El lote ya estaba en la sección destino; no hubo cambios.");
          } else if (moveMode === "all") {
            logs.push(`Moved all ${atomicMove.moved_count} heads to new section: OK`);
          } else if (moveMode === "split") {
            logs.push(`Moved ${atomicMove.moved_count} heads to new section: OK (atomic split)`);
          } else {
            logs.push(`Error moving cattle: transactional move returned unknown mode ${moveMode}`);
          }
          continue;
        }
        if (transactionalMoveError && !moveFunctionMissing) {
          logs.push(`Error moving cattle: ${transactionalMoveError.message}`);
          continue;
        }

        const { data: destination, error: destinationErr } = await dbOperation(db
          .from("sections")
          .select("id")
          .eq("id", newSectionId)
          .eq("farm_id", farmId)
          .single());
        if (destinationErr || !destination) {
          logs.push(`Error moving cattle: destination section not found (${newSectionId})`);
          continue;
        }

        // Fetch the source cattle record
        const { data: source, error: fetchErr } = await dbOperation(db
          .from("cattle")
          .select("*")
          .eq("id", match.id)
          .eq("farm_id", farmId)
          .single());

        if (fetchErr || !source) {
          logs.push(`Error moving cattle: source record not found (${match.id})`);
          continue;
        }

        const split = computeCattleSplit(source.count, moveCount);
        if (split.mode === "invalid") {
          logs.push(`Error moving cattle: ${split.reason}`);
          continue;
        }

        if (moveFunctionMissing && split.mode === "split") {
          logs.push("Error moving cattle: aplicá supabase/021_cattle_move_transaction.sql para dividir lotes de forma segura");
          continue;
        }

        if (split.mode === "all") {
          // Move the entire batch — just update section_id
          const { error } = await dbOperation(db
            .from("cattle")
            .update({ section_id: newSectionId })
            .eq("id", source.id)
            .eq("farm_id", farmId));

          if (error) {
            logs.push(`Error moving cattle: ${error.message}`);
          } else {
            logs.push(`Moved all ${source.count} ${source.category} to new section: OK`);
          }
        } else {
          // Partial move — reduce source count, create new record at destination
          const { error: updateErr } = await dbOperation(db
            .from("cattle")
            .update({ count: split.remaining })
            .eq("id", source.id)
            .eq("farm_id", farmId));

          if (updateErr) {
            logs.push(`Error reducing source count: ${updateErr.message}`);
            continue;
          }

          // Create new record at destination with same attributes
          const { error: insertErr } = await dbOperation(db
            .from("cattle")
            .insert({
              farm_id: farmId,
              section_id: newSectionId,
              category: source.category,
              breed: source.breed,
              count: moveCount,
              tag_range: source.tag_range,
              ear_tag: null, // ear tags don't carry over in a split
              health_status: source.health_status,
              weight_kg: source.weight_kg,
              origin: source.origin,
              vaccination_status: source.vaccination_status,
              reproductive_status: source.reproductive_status,
              notes: null,
            })
            .select()
            .single());

          if (insertErr) {
            logs.push(`Error creating destination record: ${insertErr.message}`);
            // Rollback the count reduction
            await dbOperation(db.from("cattle").update({ count: source.count }).eq("id", source.id).eq("farm_id", farmId));
          } else {
            logs.push(`Moved ${moveCount} of ${source.count} ${source.category}: OK (split)`);
          }
        }
        continue;
      }

      // ── INSERT ──
      if (op.action === "insert") {
        const { data: inserted, error } = await dbOperation(db
          .from(op.table)
          .insert(data)
          .select()
          .single());

        if (error) {
          logs.push(`Error inserting into ${op.table}: ${error.message}`);
        } else {
          logs.push(`Inserted into ${op.table}: OK`);
          if (op.table === "sections" && inserted) {
            const nameKey = `NEW_SECTION_${data.name}`;
            newSectionIds[nameKey] = inserted.id;
          }
        }

      // ── UPDATE ──
      } else if (op.action === "update" && match) {
        if (AI_UPDATED_AT_TABLES.has(op.table) && typeof op.expectedUpdatedAt !== "string") {
          logs.push(`Error updating ${op.table}: falta la marca de tiempo esperada; pedí la propuesta de nuevo.`);
          continue;
        }
        let query = db.from(op.table).update(data);
        query = query.eq("farm_id", farmId);
        for (const [key, val] of Object.entries(match)) {
          query = query.eq(key, val);
        }
        // Optimistic concurrency: only apply if the row still has the
        // updated_at snapshotted when the proposal was confirmed, so a
        // stale confirmation can't silently overwrite a since-changed row.
        if (typeof op.expectedUpdatedAt === "string") query = query.eq("updated_at", op.expectedUpdatedAt);
        const { data: updatedRows, error } = await dbOperation(query.select("id"));
        if (error) {
          logs.push(`Error updating ${op.table}: ${error.message}`);
        } else if (typeof op.expectedUpdatedAt === "string" && (!updatedRows || updatedRows.length === 0)) {
          logs.push(`Error updating ${op.table}: el registro cambió desde que se propuso este cambio; pedí la propuesta de nuevo.`);
        } else {
          logs.push(`Updated ${op.table}: OK`);
        }

      // ── DELETE ──
      } else if (op.action === "delete" && match) {
        if (op.table === "financial_transactions") {
          const { data: linked, error: linkError } = await dbOperation(db
            .from("financial_transactions")
            .select("inventory_movement_id")
            .eq("id", match.id)
            .eq("farm_id", farmId)
            .maybeSingle());
          if (linkError) {
            logs.push(`Error checking financial link: ${linkError.message}`);
            continue;
          }
          if (linked?.inventory_movement_id) {
            logs.push("Error: linked inventory purchase entries cannot be deleted separately");
            continue;
          }
        }
        if (op.table === "inventory_items") {
          const { data: history, error: historyError } = await dbOperation(db
            .from("inventory_movements")
            .select("id")
            .eq("item_id", match.id)
            .eq("farm_id", farmId)
            .limit(1)
            .maybeSingle());
          if (historyError) {
            logs.push(`Error checking inventory history: ${historyError.message}`);
            continue;
          }
          if (history) {
            logs.push("Error: inventory items with movement history cannot be deleted");
            continue;
          }
        }
        if (AI_UPDATED_AT_TABLES.has(op.table) && typeof op.expectedUpdatedAt !== "string") {
          logs.push(`Error deleting from ${op.table}: falta la marca de tiempo esperada; pedí la propuesta de nuevo.`);
          continue;
        }
        let query = db.from(op.table).delete();
        query = query.eq("farm_id", farmId);
        for (const [key, val] of Object.entries(match)) {
          query = query.eq(key, val);
        }
        if (typeof op.expectedUpdatedAt === "string") query = query.eq("updated_at", op.expectedUpdatedAt);
        const { data: deletedRows, error } = await dbOperation(query.select("id"));
        if (error) {
          logs.push(`Error deleting from ${op.table}: ${error.message}`);
        } else if (typeof op.expectedUpdatedAt === "string" && (!deletedRows || deletedRows.length === 0)) {
          logs.push(`Error deleting from ${op.table}: el registro cambió desde que se propuso este cambio; pedí la propuesta de nuevo.`);
        } else {
          logs.push(`Deleted from ${op.table}: OK`);
        }
      }
    } catch (e) {
      if (e instanceof AIOperationTimeout) {
        logs.push("Error: se agotó el tiempo para aplicar los cambios del asistente; reintentá el mensaje.");
        break;
      }
      logs.push(`Exception on ${op.table}: ${e}`);
    }
  }

  return logs;
}
