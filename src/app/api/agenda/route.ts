import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { OPEN_TASK_STATUSES } from "@/lib/tasks";
import { requireFarm } from "@/lib/auth";
import { databaseFailure } from "@/lib/api-error";
import { agendaWindowHorizon, buildAgenda, filterAgendaWindow, parseAgendaWindow, type AgendaInputs } from "@/lib/agenda";
import { addDays } from "@/lib/calendar-grid";
import { farmLocalToday } from "@/lib/date";
import { withTimeout } from "@/lib/timeout";
import { splitPage } from "@/lib/pagination";

const MAX_HORIZON_DAYS = 180;
const MAX_SOURCE_ROWS = 1000;
const AGENDA_QUERY_TIMEOUT_MS = 7000;

function isMissingTasksTable(error: { code?: string; message?: string } | null): boolean {
  return error?.code === "PGRST205"
    || error?.code === "42P01"
    || /(?:relation|table).*tasks.*(?:does not exist|not found)/i.test(error?.message || "");
}

function relation<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] || null : value || null;
}

/**
 * GET /api/agenda?days=N — overdue work plus the next N days (list view).
 * GET /api/agenda?from=YYYY-MM-DD&to=YYYY-MM-DD — only items dated inside the
 * window, overdue ones on their original day (calendar view), plus how many
 * overdue items are dated before it. The window is validated and capped by
 * parseAgendaWindow; every query is farm-scoped.
 */
export async function GET(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const params = req.nextUrl.searchParams;
  const today = farmLocalToday(Date.now());
  const parsedWindow = parseAgendaWindow(params.get("from"), params.get("to"), today);
  if (parsedWindow && "error" in parsedWindow) return NextResponse.json({ error: parsedWindow.error }, { status: 400 });
  const calendarWindow = parsedWindow?.window ?? null;

  const rawDays = Number(params.get("days"));
  const horizonDays = calendarWindow
    ? agendaWindowHorizon(calendarWindow, today)
    : Number.isFinite(rawDays) && rawDays > 0 ? Math.min(Math.floor(rawDays), MAX_HORIZON_DAYS) : 60;
  // Rows store a date, a local midnight or a UTC midnight: pad the database
  // bounds one day each side and cut on the calendar day after buildAgenda.
  const lower = calendarWindow ? addDays(calendarWindow.from, -1) : null;
  const upper = calendarWindow ? addDays(calendarWindow.to, 2) : null;
  // Pending work dated before the window (and before today) is overdue but
  // off screen; the calendar says how many there are.
  const overdueBound = calendarWindow ? (calendarWindow.from < today ? calendarWindow.from : today) : null;

  const db = getSupabaseAdmin();
  let vaccinationQuery = db.from("vaccinations")
    .select("id, vaccine_name, next_due, section_id, cattle_id, sections(name)", { count: "exact" })
    .eq("farm_id", result.farmId)
    .not("next_due", "is", null);
  let cropQuery = db.from("crops")
    .select("id, crop_type, status, expected_harvest, actual_harvest, section_id, sections(name)", { count: "exact" })
    .eq("farm_id", result.farmId)
    .not("expected_harvest", "is", null)
    .is("actual_harvest", null);
  let taskQuery = db.from("tasks")
    .select("id, title, due_date, priority, status, section_id, cattle_id, crop_id, sections(name)", { count: "exact" })
    .eq("farm_id", result.farmId)
    .in("status", [...OPEN_TASK_STATUSES])
    .not("due_date", "is", null);
  if (lower && upper) {
    vaccinationQuery = vaccinationQuery.gte("next_due", lower).lt("next_due", upper);
    cropQuery = cropQuery.gte("expected_harvest", lower).lt("expected_harvest", upper);
    taskQuery = taskQuery.gte("due_date", lower).lt("due_date", upper);
  }

  const overdueCounts = overdueBound
    ? Promise.all([
      db.from("vaccinations").select("id", { count: "exact", head: true })
        .eq("farm_id", result.farmId)
        .lt("next_due", overdueBound),
      db.from("crops").select("id", { count: "exact", head: true })
        .eq("farm_id", result.farmId)
        .is("actual_harvest", null)
        .or("status.is.null,status.not.in.(harvested,failed)")
        .lt("expected_harvest", overdueBound),
      db.from("tasks").select("id", { count: "exact", head: true })
        .eq("farm_id", result.farmId)
        .in("status", [...OPEN_TASK_STATUSES])
        .lt("due_date", overdueBound),
    ])
    : Promise.resolve(null);

  const queryResults = await withTimeout(
    Promise.all([
      Promise.all([
        vaccinationQuery.order("next_due").limit(MAX_SOURCE_ROWS + 1),
        cropQuery.order("expected_harvest").limit(MAX_SOURCE_ROWS + 1),
        taskQuery.order("due_date").limit(MAX_SOURCE_ROWS + 1),
      ]),
      overdueCounts,
    ]),
    AGENDA_QUERY_TIMEOUT_MS,
    null,
  );

  if (!queryResults) {
    return NextResponse.json({ error: "La agenda tardó demasiado. Intentá nuevamente." }, { status: 504 });
  }

  const [[vaccinations, crops, tasks], overdueResults] = queryResults;
  if (vaccinations.error) return databaseFailure("agenda vaccinations lookup", vaccinations.error);
  if (crops.error) return databaseFailure("agenda crops lookup", crops.error);
  if (tasks.error && !isMissingTasksTable(tasks.error)) return databaseFailure("agenda tasks lookup", tasks.error);
  let overdueBeforeWindow = 0;
  if (overdueResults) {
    const [vaccinationCount, cropCount, taskCount] = overdueResults;
    if (vaccinationCount.error) return databaseFailure("agenda overdue vaccinations count", vaccinationCount.error);
    if (cropCount.error) return databaseFailure("agenda overdue crops count", cropCount.error);
    if (taskCount.error && !isMissingTasksTable(taskCount.error)) return databaseFailure("agenda overdue tasks count", taskCount.error);
    overdueBeforeWindow = (vaccinationCount.count ?? 0) + (cropCount.count ?? 0) + (taskCount.error ? 0 : taskCount.count ?? 0);
  }

  const vaccinationPage = splitPage(vaccinations.data || [], MAX_SOURCE_ROWS);
  const cropsPage = splitPage(crops.data || [], MAX_SOURCE_ROWS);
  const taskPage = splitPage(tasks.data || [], MAX_SOURCE_ROWS);
  const vaccinationsTruncated = vaccinationPage.hasMore || (vaccinations.count ?? 0) > MAX_SOURCE_ROWS;
  const cropsTruncated = cropsPage.hasMore || (crops.count ?? 0) > MAX_SOURCE_ROWS;
  const tasksTruncated = !tasks.error && (taskPage.hasMore || (tasks.count ?? 0) > MAX_SOURCE_ROWS);
  const truncatedSources = [
    ...(vaccinationsTruncated ? ["vaccinations"] : []),
    ...(cropsTruncated ? ["crops"] : []),
    ...(tasksTruncated ? ["tasks"] : []),
  ];
  const input: AgendaInputs = {
    vaccinations: vaccinationPage.items.map((row) => ({ ...row, sections: relation(row.sections) })) as unknown as AgendaInputs["vaccinations"],
    crops: cropsPage.items.map((row) => ({ ...row, sections: relation(row.sections) })) as unknown as AgendaInputs["crops"],
    tasks: tasks.error ? [] : taskPage.items.map((row) => ({ ...row, sections: relation(row.sections) })) as unknown as AgendaInputs["tasks"],
  };

  const items = buildAgenda(input, Date.now(), horizonDays);
  const response = NextResponse.json({
    items: calendarWindow ? filterAgendaWindow(items, calendarWindow) : items,
    horizonDays,
    ...(calendarWindow ? { window: calendarWindow, overdueBeforeWindow } : {}),
    migrationRequired: Boolean(tasks.error && isMissingTasksTable(tasks.error)),
    vaccinationsTruncated,
    cropsTruncated,
    tasksTruncated,
    truncatedSources,
  });
  response.headers.set("X-CampoAI-Agenda-Source-Limit", String(MAX_SOURCE_ROWS));
  if (vaccinationsTruncated) response.headers.set("X-CampoAI-Agenda-Vaccinations-Truncated", "true");
  if (cropsTruncated) response.headers.set("X-CampoAI-Agenda-Crops-Truncated", "true");
  if (tasksTruncated) response.headers.set("X-CampoAI-Agenda-Tasks-Truncated", "true");
  return response;
}
