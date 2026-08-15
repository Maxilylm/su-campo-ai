import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireFarm } from "@/lib/auth";
import { databaseFailure } from "@/lib/api-error";
import { buildAgenda, type AgendaInputs } from "@/lib/agenda";
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

export async function GET(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const rawDays = Number(req.nextUrl.searchParams.get("days"));
  const horizonDays = Number.isFinite(rawDays) && rawDays > 0 ? Math.min(Math.floor(rawDays), MAX_HORIZON_DAYS) : 60;
  const db = getSupabaseAdmin();
  const queryResults = await withTimeout(
    Promise.all([
      db.from("vaccinations")
        .select("id, vaccine_name, next_due, section_id, cattle_id, sections(name)", { count: "exact" })
        .eq("farm_id", result.farmId)
        .not("next_due", "is", null)
        .order("next_due")
        .limit(MAX_SOURCE_ROWS + 1),
      db.from("crops")
        .select("id, crop_type, status, expected_harvest, actual_harvest, section_id, sections(name)", { count: "exact" })
        .eq("farm_id", result.farmId)
        .not("expected_harvest", "is", null)
        .is("actual_harvest", null)
        .order("expected_harvest")
        .limit(MAX_SOURCE_ROWS + 1),
      db.from("tasks")
        .select("id, title, due_date, priority, status, section_id, cattle_id, crop_id, sections(name)", { count: "exact" })
        .eq("farm_id", result.farmId)
        .eq("status", "pending")
        .not("due_date", "is", null)
        .order("due_date")
        .limit(MAX_SOURCE_ROWS + 1),
    ]),
    AGENDA_QUERY_TIMEOUT_MS,
    null,
  );

  if (!queryResults) {
    return NextResponse.json({ error: "La agenda tardó demasiado. Intentá nuevamente." }, { status: 504 });
  }

  const [vaccinations, crops, tasks] = queryResults;
  if (vaccinations.error) return databaseFailure("agenda vaccinations lookup", vaccinations.error);
  if (crops.error) return databaseFailure("agenda crops lookup", crops.error);
  if (tasks.error && !isMissingTasksTable(tasks.error)) return databaseFailure("agenda tasks lookup", tasks.error);

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

  const response = NextResponse.json({
    items: buildAgenda(input, Date.now(), horizonDays),
    horizonDays,
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
