import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireFarm } from "@/lib/auth";
import { withTimeout } from "@/lib/timeout";
import { adjustAgendaToLocalDay, buildAgenda, type AgendaInputs } from "@/lib/agenda";
import { buildDailyPlan } from "@/lib/daily-plan";
import { loadFieldStatus } from "@/lib/field-status-server";
import { getFarmWeather } from "@/lib/weather-server";
import { isValidDateOnly } from "@/lib/date";

const PLAN_QUERY_TIMEOUT_MS = 7000;
const OPTIONAL_WEATHER_TIMEOUT_MS = 2500;
const MAX_SOURCE_ROWS = 500;
const LOOKAHEAD_DAYS = 2;

function relation<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] || null : value || null;
}

// "Plan del día": overdue and near-term work, rotation moves and water
// problems grouped by potrero, gated by today's weather. `today` is the
// browser's local date, since the server's clock is UTC and the farm's day
// boundary is not.
export async function GET(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const requestedToday = req.nextUrl.searchParams.get("today");
  const today = isValidDateOnly(requestedToday) ? requestedToday : new Date().toISOString().slice(0, 10);
  const db = getSupabaseAdmin();
  const farmId = result.farmId;
  // Anything due up to the lookahead, plus everything overdue.
  const until = new Date(Date.parse(`${today}T00:00:00Z`) + (LOOKAHEAD_DAYS + 1) * 86_400_000).toISOString().slice(0, 10);

  const [queries, field, farm] = await Promise.all([
    withTimeout(
      Promise.all([
        db.from("vaccinations").select("id, vaccine_name, next_due, section_id, cattle_id, sections(name)").eq("farm_id", farmId).not("next_due", "is", null).lte("next_due", until).order("next_due").limit(MAX_SOURCE_ROWS),
        db.from("crops").select("id, crop_type, status, expected_harvest, actual_harvest, section_id, sections(name)").eq("farm_id", farmId).not("expected_harvest", "is", null).is("actual_harvest", null).lte("expected_harvest", until).order("expected_harvest").limit(MAX_SOURCE_ROWS),
        db.from("tasks").select("id, title, due_date, priority, status, section_id, cattle_id, crop_id, sections(name)").eq("farm_id", farmId).eq("status", "pending").not("due_date", "is", null).lte("due_date", until).order("due_date").limit(MAX_SOURCE_ROWS),
      ]),
      PLAN_QUERY_TIMEOUT_MS,
      null,
    ),
    loadFieldStatus(db, farmId),
    db.from("farms").select("location, operation_type").eq("id", farmId).single(),
  ]);

  if (!queries) return NextResponse.json({ error: "El plan del día tardó demasiado. Intentá nuevamente." }, { status: 504 });
  const [vaccinations, crops, tasks] = queries;
  if (vaccinations.error || crops.error) return NextResponse.json({ error: "No se pudo armar el plan del día." }, { status: 503 });

  const input: AgendaInputs = {
    vaccinations: (vaccinations.data ?? []).map((row) => ({ ...row, sections: relation(row.sections) })) as unknown as AgendaInputs["vaccinations"],
    crops: (crops.data ?? []).map((row) => ({ ...row, sections: relation(row.sections) })) as unknown as AgendaInputs["crops"],
    tasks: tasks.error ? [] : (tasks.data ?? []).map((row) => ({ ...row, sections: relation(row.sections) })) as unknown as AgendaInputs["tasks"],
  };
  // Long horizon so overdue items are kept; the plan trims to the lookahead.
  const agenda = adjustAgendaToLocalDay(buildAgenda(input, Date.now(), 365), today);

  // Weather and potreros enrich the plan; neither may hold the core list hostage.
  const weather = await withTimeout(getFarmWeather(farm.data?.location), OPTIONAL_WEATHER_TIMEOUT_MS, { available: false as const, reason: "timeout" });
  const todayForecast = weather.available ? weather.daily?.find((day) => day.date === today) : undefined;
  const livestock = farm.data?.operation_type !== "crops";

  const plan = buildDailyPlan({
    today,
    agenda,
    statuses: field.ok ? field.sections : [],
    rotation: field.ok && livestock ? field.rotation : [],
    weather: weather.available && weather.current
      ? { current: weather.current, ...(todayForecast ? { today: { tmax: todayForecast.tmax, precip: todayForecast.precip } } : {}) }
      : null,
    lookaheadDays: LOOKAHEAD_DAYS,
  });

  return NextResponse.json({
    ...plan,
    // Potrero status lets the page open the move dialog without a second read.
    sections: field.ok && livestock ? field.sections : [],
    fieldStatusAvailable: field.ok,
    weatherAvailable: plan.weather !== null,
  });
}
