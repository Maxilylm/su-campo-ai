// Decides which model-proposed writes need the user's confirmation and
// prepares the signed proposal (with updated_at snapshots) for them.
import { getSupabaseAdmin } from "./supabase";
import { withTimeout } from "./timeout";
import { buildAIChangeLinks, formatAIChangeLabels } from "./ai-change-links";
import { type AIOperation } from "./ai-operation";
import { createAIConfirmation } from "./ai-confirmation";
import { isAIHandoffReviewPrompt } from "./ai-confirmation-text";
import { gateAutoInsert, type InsertGateVerdict } from "./ai-insert-gate";
import { AI_UPDATED_AT_TABLES } from "./ai-execute";
import { type AIAction } from "./ai-action";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REFERENCE_NAMES_TIMEOUT_MS = 1_000;

/** Names for the records an operation points at (potreros, lotes, cultivos,
 * insumos), so the insert gate can compare them with the farmer's words.
 * Best-effort: on any failure the gate just sees fewer names. */
async function operationReferenceNames(farmId: string, operations: AIOperation[]): Promise<Map<string, string>> {
  const ids = new Set<string>();
  for (const operation of operations) {
    for (const value of Object.values(operation.data ?? {})) {
      if (typeof value === "string" && UUID_PATTERN.test(value)) ids.add(value);
    }
  }
  const names = new Map<string, string>();
  if (ids.size === 0) return names;
  const db = getSupabaseAdmin();
  const list = Array.from(ids).slice(0, 50);
  const results = await withTimeout(Promise.all([
    db.from("sections").select("id, name").eq("farm_id", farmId).in("id", list),
    db.from("crops").select("id, crop_type").eq("farm_id", farmId).in("id", list),
    db.from("cattle").select("id, count, category").eq("farm_id", farmId).in("id", list),
    db.from("inventory_items").select("id, name").eq("farm_id", farmId).in("id", list),
  ]), REFERENCE_NAMES_TIMEOUT_MS, null);
  if (!results) return names;
  const [sections, crops, cattle, items] = results;
  for (const row of sections.data ?? []) names.set(row.id, row.name);
  for (const row of crops.data ?? []) names.set(row.id, row.crop_type);
  for (const row of cattle.data ?? []) names.set(row.id, `${row.count} ${row.category}`);
  for (const row of items.data ?? []) names.set(row.id, row.name);
  return names;
}

/** Snapshot each targeted row's updated_at at proposal time, so the signed
 * confirmation token can bind to it (executeOperations rejects the op if
 * the row changed by the time the user confirms). Only applies to
 * update/delete ops on AI_UPDATED_AT_TABLES targeting exactly one id --
 * inserts have no existing row, and other tables have no column to check. */
async function snapshotExpectedUpdatedAt(farmId: string, operations: AIOperation[]): Promise<AIOperation[]> {
  const idsByTable = new Map<string, Set<string>>();
  for (const op of operations) {
    if ((op.action === "update" || op.action === "delete") && AI_UPDATED_AT_TABLES.has(op.table) && typeof op.match?.id === "string") {
      if (!idsByTable.has(op.table)) idsByTable.set(op.table, new Set());
      idsByTable.get(op.table)!.add(op.match.id);
    }
  }
  if (idsByTable.size === 0) return operations;

  const db = getSupabaseAdmin();
  const snapshot = new Map<string, string>();
  await Promise.all(Array.from(idsByTable.entries()).map(async ([table, ids]) => {
    const { data, error } = await db.from(table).select("id, updated_at").eq("farm_id", farmId).in("id", Array.from(ids));
    if (error) {
      console.error(`snapshotExpectedUpdatedAt: failed to read ${table}`, error);
      return;
    }
    for (const row of data || []) {
      if (typeof row.updated_at === "string") snapshot.set(`${table}:${row.id}`, row.updated_at);
    }
  }));

  return operations.map((op) => {
    if ((op.action === "update" || op.action === "delete") && AI_UPDATED_AT_TABLES.has(op.table) && typeof op.match?.id === "string") {
      // Always overwrite (never trust) any expectedUpdatedAt the model may
      // have put in its own proposal -- this is the only place that sets it.
      const { expectedUpdatedAt: _modelSupplied, ...rest } = op;
      void _modelSupplied;
      const snapshotted = snapshot.get(`${op.table}:${op.match.id}`);
      return snapshotted ? { ...rest, expectedUpdatedAt: snapshotted } : rest;
    }
    return op;
  });
}

const AI_CONFIRMATION_CLOSING = "Todavía no guardé cambios. Revisá esta propuesta y confirmá cuando quieras aplicarla.";

// When the semantic gate is what held the write, say which doubt it was:
// "confirmá esto" reads as bureaucracy, "I may have misheard you" reads as a
// reason to actually look at the proposal.
const AI_INSERT_GATE_CLOSING: Record<"intencion" | "coincidencia", string> = {
  intencion: "No estoy seguro de haber entendido bien tu mensaje, así que todavía no guardé nada. Revisá esta propuesta y confirmá si es correcta.",
  coincidencia: "Para no anotar datos que no mencionaste, todavía no guardé nada. Revisá esta propuesta y confirmá si es correcta.",
};

/** Model-proposed writes are shown to the user before they reach the database
 * when they come from a handoff review prompt, or when they change or remove
 * existing records. Farm data and shared history flow into the prompt, so the
 * model's output is untrusted: only plain inserts, which are idempotent and
 * easy to undo, apply without an explicit confirmation.
 *
 * That structural rule is blind to what the message actually said, so inserts
 * clearing it get a second, semantic check from Jev (see ai-insert-gate.ts)
 * before applying unattended. With no TYPESAFE_API_KEY configured the check
 * is skipped and inserts apply exactly as they did before it existed. */
export async function requireAIConfirmation(
  farmId: string,
  subjectId: string,
  message: string,
  action: AIAction,
  proposalRequestId?: string | null,
): Promise<AIAction> {
  if (!action.dbOperations?.length) return action;
  const changesExistingRecords = action.dbOperations.some((operation) => operation.action !== "insert");
  const structurallyNeedsReview = isAIHandoffReviewPrompt(message) || changesExistingRecords;

  // Consulted only on the path that would otherwise skip review entirely, so
  // a write already headed for confirmation costs no extra call.
  const gate: InsertGateVerdict = structurallyNeedsReview
    ? { confirm: false }
    : await gateAutoInsert(message, action.dbOperations, await operationReferenceNames(farmId, action.dbOperations));
  if (!structurallyNeedsReview && !gate.confirm) return action;

  const operationsWithSnapshot = await snapshotExpectedUpdatedAt(farmId, action.dbOperations);
  const pendingConfirmationLinks = buildAIChangeLinks(operationsWithSnapshot);
  const affectedLabels = formatAIChangeLabels(pendingConfirmationLinks);
  const confirmation = createAIConfirmation(farmId, subjectId, operationsWithSnapshot, Date.now(), proposalRequestId || undefined);
  return {
    ...action,
    dbOperations: [],
    response: `${action.response.trim()}${affectedLabels ? `\n\n📌 Afecta: ${affectedLabels}.` : ""}\n\n${gate.confirm ? AI_INSERT_GATE_CLOSING[gate.reason] : AI_CONFIRMATION_CLOSING}`,
    pendingConfirmationToken: confirmation.token,
    pendingConfirmationRequestId: confirmation.requestId,
    pendingConfirmationExpiresAt: confirmation.expiresAt,
    ...(confirmation.proposalRequestId ? { pendingConfirmationProposalRequestId: confirmation.proposalRequestId } : {}),
    ...(pendingConfirmationLinks.length > 0 ? { pendingConfirmationLinks } : {}),
  };
}

