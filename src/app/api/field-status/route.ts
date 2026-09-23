import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireFarm } from "@/lib/auth";
import { withTimeout } from "@/lib/timeout";
import { buildFieldStatus, fieldTotals, mergeOccupancy, planRotation, type SectionOccupancyRow } from "@/lib/grazing";

const FIELD_STATUS_TIMEOUT_MS = 7000;
const MAX_ROWS = 2000;

// What is in each potrero right now: heads by category, stocking, active
// crops and the grazing/rest clock. One read feeds the map, the daily plan
// and the assistant, so they never disagree about where the animals are.
export async function GET() {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const db = getSupabaseAdmin();
  const farmId = result.farmId;
  const queries = await withTimeout(
    Promise.all([
      db.from("sections").select("id, name, size_hectares, capacity, color, water_status, pasture_status, padron_id, map_center").eq("farm_id", farmId).order("name").limit(MAX_ROWS),
      db.from("cattle").select("id, section_id, category, count, breed, health_status").eq("farm_id", farmId).limit(MAX_ROWS),
      db.from("crops").select("id, section_id, crop_type, variety, status, planted_hectares, expected_harvest").eq("farm_id", farmId).in("status", ["planted", "growing"]).limit(MAX_ROWS),
      db.from("section_occupancy").select("section_id, occupied_since, last_vacated_at").eq("farm_id", farmId).limit(MAX_ROWS),
    ]),
    FIELD_STATUS_TIMEOUT_MS,
    null,
  );
  if (!queries) {
    return NextResponse.json({ error: "El estado de los potreros tardó demasiado. Intentá nuevamente." }, { status: 504 });
  }
  const [sections, cattle, crops, occupancy] = queries;
  if (sections.error || cattle.error || crops.error) {
    return NextResponse.json({ error: "No se pudo cargar el estado de los potreros." }, { status: 503 });
  }

  // The clock (045) enriches the status but never blocks it: before the
  // migration, or if that read fails, potreros show without day counts.
  const occupancyRows: SectionOccupancyRow[] = occupancy.error ? [] : occupancy.data ?? [];
  const statuses = buildFieldStatus(mergeOccupancy(sections.data ?? [], occupancyRows), cattle.data ?? [], crops.data ?? [], Date.now());
  return NextResponse.json({ sections: statuses, totals: fieldTotals(statuses), rotation: planRotation(statuses) });
}
