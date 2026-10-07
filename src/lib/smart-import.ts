// Decide how to read a spreadsheet table (hacienda or inventario, which
// columns) without AI when its headers are recognizable, and build the
// editable drafts from either that or the AI's mapping.
import {
  cattleCategoryHitRate, cattleDraftsFromTable, detectCattleMapping, resolveDraftSections,
  type CattleDraft, type CattleSheetMapping, type SectionOption,
} from "./cattle-import";
import { detectInventoryMapping, inventoryDraftsFromTable, type InventoryDraft, type InventorySheetMapping } from "./inventory-import";
import type { ImportTarget, RequestedImportTarget } from "./ai-import";
import type { ImportTable } from "./import-table";

export type TableInterpretation =
  | { target: "cattle"; mapping: CattleSheetMapping }
  | { target: "inventory"; mapping: InventorySheetMapping };

export type ImportDrafts =
  | { target: "cattle"; drafts: CattleDraft[] }
  | { target: "inventory"; drafts: InventoryDraft[] };

/** Below this share of recognizable category texts the AI is asked to map them. */
const CATEGORY_CONFIDENCE = 0.5;

/**
 * Recognize a table by its headers. `confident` is false when the result is
 * only a fallback (columns found but category texts mostly unknown) or when
 * nothing was recognized, which is when the AI mapping should be tried.
 */
export function interpretTable(table: ImportTable, requested: RequestedImportTarget): { interpretation: TableInterpretation | null; confident: boolean } {
  const cattle = requested === "inventory" ? null : detectCattleMapping(table.headers);
  // Without a count or caravana column every row would silently become one
  // head ("Nº" in a DICOSE layout), so that also goes to the AI.
  const cattleConfident = cattle !== null
    && (cattle.categoryColumns !== undefined || cattle.columns.count !== undefined || cattle.columns.earTag !== undefined)
    && cattleCategoryHitRate(table, cattle) >= CATEGORY_CONFIDENCE;
  const inventory = requested === "cattle" ? null : detectInventoryMapping(table.headers);
  if (cattle && (cattleConfident || requested === "cattle")) {
    return { interpretation: { target: "cattle", mapping: cattle }, confident: cattleConfident };
  }
  if (inventory) return { interpretation: { target: "inventory", mapping: inventory }, confident: true };
  if (cattle) return { interpretation: { target: "cattle", mapping: cattle }, confident: false };
  return { interpretation: null, confident: false };
}

/** Build drafts from a table and its mapping; hacienda drafts get their potreros resolved. */
export function draftsFromTable(
  table: ImportTable,
  interpretation: TableInterpretation,
  sections: readonly SectionOption[],
): ImportDrafts & { skipped: number; warnings: string[] } {
  if (interpretation.target === "cattle") {
    const { drafts, skipped, warnings } = cattleDraftsFromTable(table, interpretation.mapping);
    return { target: "cattle", drafts: resolveDraftSections(drafts, sections), skipped, warnings };
  }
  const { drafts, skipped, warnings } = inventoryDraftsFromTable(table, interpretation.mapping);
  return { target: "inventory", drafts, skipped, warnings };
}

export function importTargetLabel(target: ImportTarget): string {
  return target === "cattle" ? "Hacienda" : "Inventario";
}
