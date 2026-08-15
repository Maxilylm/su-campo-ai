import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireFarm } from "@/lib/auth";
import { databaseFailure } from "@/lib/api-error";
import { buildFarmCalendarEvents, toICalendar } from "@/lib/calendar";
import { withTimeout } from "@/lib/timeout";
import { splitPage } from "@/lib/pagination";

const MAX_EVENTS = 2000;
const CALENDAR_QUERY_TIMEOUT_MS = 7000;

function isMissingTasksTable(error: { code?: string; message?: string } | null): boolean {
  return error?.code === "PGRST205"
    || error?.code === "42P01"
    || /(?:relation|table).*tasks.*(?:does not exist|not found)/i.test(error?.message || "");
}

function safeFilename(name: string): string {
  const normalized = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  return normalized.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "campoai";
}

function calendarTooLarge(sources: string[], counts: Record<string, number | null>) {
  const labels: Record<string, string> = {
    vaccinations: "vacunaciones",
    crops: "cultivos",
    tasks: "tareas pendientes",
  };
  const describedSources = sources.map((source) => ({
    source,
    label: labels[source] || source,
    count: counts[source],
  }));
  return NextResponse.json({
    error: `El calendario supera el límite de ${MAX_EVENTS.toLocaleString("es-UY")} eventos en: ${describedSources.map((item) => item.label).join(", ")}. Exportá esas fuentes por separado y volvé a intentar.`,
    code: "calendar_too_large",
    limit: MAX_EVENTS,
    sources: describedSources,
  }, {
    status: 413,
    headers: {
      "X-CampoAI-Calendar-Limit": String(MAX_EVENTS),
      "X-CampoAI-Calendar-Truncated-Sources": sources.join(","),
    },
  });
}

export async function GET(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const db = getSupabaseAdmin();
  const queryResults = await withTimeout(
    Promise.all([
      db.from("farms").select("name").eq("id", result.farmId).single(),
      db.from("vaccinations")
        .select("id, vaccine_name, next_due, sections(name)", { count: "exact" })
        .eq("farm_id", result.farmId)
        .not("next_due", "is", null)
        .order("next_due")
        .limit(MAX_EVENTS + 1),
      db.from("crops")
        .select("id, crop_type, expected_harvest, actual_harvest, sections(name)", { count: "exact" })
        .eq("farm_id", result.farmId)
        .not("expected_harvest", "is", null)
        .order("expected_harvest")
        .limit(MAX_EVENTS + 1),
      db.from("tasks")
        .select("id, title, description, due_date, priority, status, sections(name), cattle(category, count), crops(crop_type)", { count: "exact" })
        .eq("farm_id", result.farmId)
        .eq("status", "pending")
        .not("due_date", "is", null)
        .order("due_date")
        .limit(MAX_EVENTS + 1),
    ]),
    CALENDAR_QUERY_TIMEOUT_MS,
    null,
  );

  if (!queryResults) {
    return NextResponse.json({ error: "El calendario tardó demasiado. Intentá nuevamente." }, { status: 504 });
  }

  const [farm, vaccinations, crops, tasks] = queryResults;

  if (farm.error) return databaseFailure("calendar farm lookup", farm.error);
  if (vaccinations.error) return databaseFailure("calendar vaccinations lookup", vaccinations.error);
  if (crops.error) return databaseFailure("calendar crops lookup", crops.error);
  if (tasks.error && !isMissingTasksTable(tasks.error)) return databaseFailure("calendar tasks lookup", tasks.error);

  const vaccinationPage = splitPage(vaccinations.data || [], MAX_EVENTS);
  const cropPage = splitPage(crops.data || [], MAX_EVENTS);
  const taskPage = splitPage(tasks.data || [], MAX_EVENTS);
  const vaccinationTruncated = vaccinationPage.hasMore || (vaccinations.count ?? 0) > MAX_EVENTS;
  const cropTruncated = cropPage.hasMore || (crops.count ?? 0) > MAX_EVENTS;
  const taskTruncated = !tasks.error && (taskPage.hasMore || (tasks.count ?? 0) > MAX_EVENTS);
  const truncatedSources = [
    ...(vaccinationTruncated ? ["vaccinations"] : []),
    ...(cropTruncated ? ["crops"] : []),
    ...(taskTruncated ? ["tasks"] : []),
  ];
  if (truncatedSources.length > 0) {
    return calendarTooLarge(truncatedSources, {
      vaccinations: vaccinations.count,
      crops: crops.count,
      tasks: tasks.count,
    });
  }

  const farmName = farm.data?.name || "Mi Campo";
  const calendarVaccinations = vaccinationPage.items.map((row) => ({
    ...row,
    sections: Array.isArray(row.sections) ? (row.sections[0] || null) : row.sections,
  }));
  const calendarCrops = cropPage.items.map((row) => ({
    ...row,
    sections: Array.isArray(row.sections) ? (row.sections[0] || null) : row.sections,
  }));
  const calendarTasks = (tasks.error ? [] : taskPage.items).map((row) => ({
    ...row,
    sections: Array.isArray(row.sections) ? (row.sections[0] || null) : row.sections,
    cattle: Array.isArray(row.cattle) ? (row.cattle[0] || null) : row.cattle,
    crops: Array.isArray(row.crops) ? (row.crops[0] || null) : row.crops,
  }));
  const events = buildFarmCalendarEvents({
    farmName,
    vaccinations: calendarVaccinations,
    crops: calendarCrops,
    tasks: calendarTasks,
  });
  // Calendar apps open URL properties outside the browser session. Resolve the
  // internal deep-links against the current deployment so every event remains
  // actionable after it is imported into Google/Apple Calendar.
  const calendar = toICalendar(events, farmName, new Date(), new URL(req.url).origin);

  return new NextResponse(calendar, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": "attachment; filename=\"" + safeFilename(farmName) + "-campoai.ics\"",
      "Cache-Control": "private, no-store",
      "X-CampoAI-Calendar-Limit": String(MAX_EVENTS),
      "X-CampoAI-Calendar-Complete": "true",
    },
  });
}
