import type { FieldGraph } from "./field-graph";
import type { FieldTotals, RotationMove, SectionFieldStatus } from "./grazing";
import { isOfflineSnapshotFresh } from "./offline";

// The potrero panel's last online answer, kept per user so the field view
// still works where there is no signal — which is most of the field.

export interface OfflineFieldStatusSnapshot {
  savedAt: string;
  sections: SectionFieldStatus[];
  totals: FieldTotals | null;
  rotation: RotationMove[];
  /** Linderos; null for snapshots saved before the field graph existed. */
  graph: FieldGraph | null;
}

function isGraphLike(value: unknown): value is FieldGraph {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return Array.isArray(record.nodes) && Array.isArray(record.edges) && Array.isArray(record.components)
    && record.nodes.every((node) => node && typeof node === "object" && typeof (node as { id?: unknown }).id === "string")
    && record.edges.every((edge) => edge && typeof edge === "object" && typeof (edge as { a?: unknown }).a === "string" && typeof (edge as { b?: unknown }).b === "string");
}

function isSectionLike(value: unknown): value is SectionFieldStatus {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === "string" && typeof record.name === "string" && typeof record.heads === "number"
    && typeof record.summary === "string" && Array.isArray(record.batches) && Array.isArray(record.crops) && Array.isArray(record.byCategory);
}

function isMoveLike(value: unknown): value is RotationMove {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.fromSectionId === "string" && Array.isArray(record.reasons) && Array.isArray(record.destinations);
}

/** Rejects anything malformed or stale rather than rendering a half-valid
 * snapshot as if it were the farm. */
export function parseOfflineFieldStatusSnapshot(raw: string | null, now = Date.now()): OfflineFieldStatusSnapshot | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<OfflineFieldStatusSnapshot>;
    if (typeof value.savedAt !== "string" || !isOfflineSnapshotFresh(value.savedAt, now)) return null;
    if (!Array.isArray(value.sections) || !value.sections.every(isSectionLike)) return null;
    if (!Array.isArray(value.rotation) || !value.rotation.every(isMoveLike)) return null;
    const totals = value.totals && typeof value.totals === "object" ? value.totals : null;
    const graph = isGraphLike(value.graph) ? value.graph : null;
    return { savedAt: value.savedAt, sections: value.sections, totals, rotation: value.rotation, graph };
  } catch {
    return null;
  }
}
