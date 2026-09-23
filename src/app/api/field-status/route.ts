import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireFarm } from "@/lib/auth";
import { loadFieldStatus } from "@/lib/field-status-server";
import { parseJsonBody } from "@/lib/request";
import { databaseFailure } from "@/lib/api-error";
import { SUPABASE_READ_TIMEOUT_MS, withTimeout } from "@/lib/timeout";
import { isValidDateOnly } from "@/lib/date";
import { occupancyTimestamp, parseOccupancyClock } from "@/lib/occupancy-input";

// What is in each potrero right now: heads by category, stocking, active
// crops, the grazing/rest clock and suggested rotation moves.
export async function GET() {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const status = await loadFieldStatus(getSupabaseAdmin(), result.farmId);
  if (!status.ok) {
    return status.reason === "timeout"
      ? NextResponse.json({ error: "El estado de los potreros tardó demasiado. Intentá nuevamente." }, { status: 504 })
      : NextResponse.json({ error: "No se pudo cargar el estado de los potreros." }, { status: 503 });
  }
  return NextResponse.json({ sections: status.sections, totals: status.totals, rotation: status.rotation });
}

// Set the grazing clock by hand once, for potreros whose last transition
// predates migration 045. Whether the date means "animals went in" or
// "potrero was emptied" follows from whether it holds animals right now.
export async function PUT(req: NextRequest) {
  const result = await requireFarm({ write: true });
  if ("error" in result) return result.error;

  const parsed = await parseJsonBody(req);
  if ("error" in parsed) return parsed.error;
  const clientToday = parsed.data.today;
  const serverToday = new Date().toISOString().slice(0, 10);
  // The browser's day may be one ahead of or behind UTC; never later than tomorrow UTC.
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const today = isValidDateOnly(clientToday) && clientToday <= tomorrow ? clientToday : serverToday;
  const input = parseOccupancyClock(parsed.data, today);
  if (!input.ok) return NextResponse.json({ error: input.error }, { status: 400 });

  const db = getSupabaseAdmin();
  const lookup = await withTimeout(
    Promise.all([
      db.from("sections").select("id").eq("id", input.value.sectionId).eq("farm_id", result.farmId).maybeSingle(),
      db.from("cattle").select("count").eq("farm_id", result.farmId).eq("section_id", input.value.sectionId).gt("count", 0),
    ]),
    SUPABASE_READ_TIMEOUT_MS,
    null,
  );
  if (!lookup) return NextResponse.json({ error: "La actualización tardó demasiado. Intentá nuevamente." }, { status: 504 });
  const [section, cattle] = lookup;
  if (section.error) return databaseFailure("occupancy clock section lookup", section.error);
  if (cattle.error) return databaseFailure("occupancy clock cattle lookup", cattle.error);
  if (!section.data) return NextResponse.json({ error: "El potrero no existe." }, { status: 404 });

  const occupied = (cattle.data ?? []).length > 0;
  const at = occupancyTimestamp(input.value.date);
  const write = await withTimeout(
    db.from("section_occupancy").upsert({
      section_id: input.value.sectionId,
      farm_id: result.farmId,
      occupied_since: occupied ? at : null,
      ...(occupied ? {} : { last_vacated_at: at }),
      updated_at: new Date().toISOString(),
    }, { onConflict: "section_id" }),
    SUPABASE_READ_TIMEOUT_MS,
    null,
  );
  if (!write) return NextResponse.json({ error: "La actualización tardó demasiado. Intentá nuevamente." }, { status: 504 });
  if (write.error) return databaseFailure("occupancy clock write", write.error);
  return NextResponse.json({ occupied, date: input.value.date });
}
