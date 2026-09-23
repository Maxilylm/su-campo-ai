import type { SupabaseClient } from "@supabase/supabase-js";
import { withTimeout } from "./timeout";
import { buildFieldStatus, fieldTotals, mergeOccupancy, planRotation, type FieldTotals, type RotationMove, type SectionFieldStatus, type SectionOccupancyRow } from "./grazing";
import { attachGrazingHistory, grazingHistorySince } from "./grazing-history";

const FIELD_STATUS_TIMEOUT_MS = 7000;
const MAX_ROWS = 2000;

export type FieldStatusResult =
  | { ok: true; sections: SectionFieldStatus[]; totals: FieldTotals; rotation: RotationMove[] }
  | { ok: false; reason: "timeout" | "error" };

/** One read of every potrero's contents, stocking and grazing clock, shared
 * by /api/field-status, the daily plan and the assistant so they never
 * disagree about where the animals are. */
export async function loadFieldStatus(db: SupabaseClient, farmId: string, now = Date.now()): Promise<FieldStatusResult> {
  const queries = await withTimeout(
    Promise.all([
      db.from("sections").select("id, name, size_hectares, capacity, color, water_status, pasture_status, padron_id, map_center").eq("farm_id", farmId).order("name").limit(MAX_ROWS),
      db.from("cattle").select("id, section_id, category, count, breed, health_status").eq("farm_id", farmId).limit(MAX_ROWS),
      db.from("crops").select("id, section_id, crop_type, variety, status, planted_hectares, expected_harvest").eq("farm_id", farmId).in("status", ["planted", "growing"]).limit(MAX_ROWS),
      db.from("section_occupancy").select("section_id, occupied_since, last_vacated_at").eq("farm_id", farmId).limit(MAX_ROWS),
      // A little beyond the window so the rest before its first period is known.
      db.from("grazing_periods").select("section_id, started_at, ended_at, heads_at_start, peak_heads")
        .eq("farm_id", farmId)
        .or(`ended_at.is.null,ended_at.gte.${grazingHistorySince(now)}`)
        .order("started_at", { ascending: false })
        .limit(MAX_ROWS),
    ]),
    FIELD_STATUS_TIMEOUT_MS,
    null,
  );
  if (!queries) return { ok: false, reason: "timeout" };
  const [sections, cattle, crops, occupancy, periods] = queries;
  if (sections.error || cattle.error || crops.error) return { ok: false, reason: "error" };

  // The clock (045) enriches the status but never blocks it: if that read
  // fails, potreros show without day counts.
  const occupancyRows: SectionOccupancyRow[] = occupancy.error ? [] : occupancy.data ?? [];
  const statuses = buildFieldStatus(mergeOccupancy(sections.data ?? [], occupancyRows), cattle.data ?? [], crops.data ?? [], now);
  // History (047) is optional too: without it, rows just show no history line.
  if (!periods.error) attachGrazingHistory(statuses, periods.data ?? [], now);
  return { ok: true, sections: statuses, totals: fieldTotals(statuses), rotation: planRotation(statuses) };
}
