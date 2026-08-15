import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireFarm } from "@/lib/auth";
import { buildAlerts } from "@/lib/alerts";
import { getFarmWeather } from "@/lib/weather-server";
import { withTimeout } from "@/lib/timeout";

const OPTIONAL_WEATHER_TIMEOUT_MS = 1800;
const ALERTS_QUERY_TIMEOUT_MS = 7000;
const MAX_ALERT_SOURCE_ROWS = 1000;

function isMissingTasksTable(error: { code?: string; message?: string } | null): boolean {
  return error?.code === "PGRST205"
    || error?.code === "42P01"
    || /(?:relation|table).*tasks.*(?:does not exist|not found)/i.test(error?.message || "");
}

// Aggregates actionable alerts (vaccinations due, low stock, pending health,
// upcoming harvests) from existing data. No new tables.
export async function GET() {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const db = getSupabaseAdmin();
  const farmId = result.farmId;

  const queryResults = await withTimeout(
    Promise.all([
      db.from("farms").select("location").eq("id", farmId).single(),
      db.from("vaccinations").select("id, vaccine_name, next_due, section_id, cattle_id, sections(name)").eq("farm_id", farmId).not("next_due", "is", null).order("next_due").limit(MAX_ALERT_SOURCE_ROWS),
      db.from("inventory_items").select("id, name, current_stock, min_stock, unit").eq("farm_id", farmId).not("min_stock", "is", null).order("name").limit(MAX_ALERT_SOURCE_ROWS),
      db.from("health_events").select("id, type, description, resolved, section_id, cattle_id").eq("farm_id", farmId).eq("resolved", false).order("created_at", { ascending: false }).limit(MAX_ALERT_SOURCE_ROWS),
      db.from("crops").select("id, crop_type, status, expected_harvest, actual_harvest, section_id, sections(name)").eq("farm_id", farmId).not("expected_harvest", "is", null).is("actual_harvest", null).order("expected_harvest").limit(MAX_ALERT_SOURCE_ROWS),
      db.from("tasks").select("id, title, due_date, priority, status, section_id, cattle_id, crop_id, sections(name)").eq("farm_id", farmId).eq("status", "pending").not("due_date", "is", null).order("due_date").limit(MAX_ALERT_SOURCE_ROWS),
    ]),
    ALERTS_QUERY_TIMEOUT_MS,
    null,
  );

  if (!queryResults) {
    return NextResponse.json({ error: "Los pendientes tardaron demasiado. Intentá nuevamente." }, { status: 504 });
  }

  const [farm, vacc, inv, health, crops, tasks] = queryResults;

  if ([farm, vacc, inv, health, crops].some((query) => query.error) || (tasks.error && !isMissingTasksTable(tasks.error))) {
    return NextResponse.json({ error: "No se pudieron cargar las alertas." }, { status: 503 });
  }
  // Weather enriches alerts but must never hold the core action list hostage
  // when the free provider is slow or unavailable.
  const weather = await withTimeout(
    getFarmWeather(farm.data?.location),
    OPTIONAL_WEATHER_TIMEOUT_MS,
    { available: false, reason: "timeout" },
  );

  const alerts = buildAlerts(
    {
      vaccinations: (vacc.data as never[]) || [],
      inventory: (inv.data as never[]) || [],
      health: (health.data as never[]) || [],
      crops: (crops.data as never[]) || [],
      tasks: tasks.error ? [] : (tasks.data as never[]) || [],
      weather: weather.available && weather.current
        ? { wind: weather.current.wind, precip: weather.current.precip }
        : null,
    },
    Date.now()
  );

  return NextResponse.json({ alerts, count: alerts.length });
}
