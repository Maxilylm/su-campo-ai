import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireFarm } from "@/lib/auth";
import { databaseFailure } from "@/lib/api-error";
import { buildFarmCalendarEvents, toICalendar } from "@/lib/calendar";

const MAX_EVENTS = 2000;

function isMissingTasksTable(error: { code?: string; message?: string } | null): boolean {
  return error?.code === "PGRST205"
    || error?.code === "42P01"
    || /(?:relation|table).*tasks.*(?:does not exist|not found)/i.test(error?.message || "");
}

function safeFilename(name: string): string {
  const normalized = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  return normalized.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "campoai";
}

export async function GET() {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const db = getSupabaseAdmin();
  const [farm, vaccinations, crops, tasks] = await Promise.all([
    db.from("farms").select("name").eq("id", result.farmId).single(),
    db.from("vaccinations")
      .select("id, vaccine_name, next_due, sections(name)")
      .eq("farm_id", result.farmId)
      .not("next_due", "is", null)
      .order("next_due")
      .limit(MAX_EVENTS),
    db.from("crops")
      .select("id, crop_type, expected_harvest, actual_harvest, sections(name)")
      .eq("farm_id", result.farmId)
      .not("expected_harvest", "is", null)
      .order("expected_harvest")
      .limit(MAX_EVENTS),
    db.from("tasks")
      .select("id, title, description, due_date, priority, status, sections(name), cattle(category, count), crops(crop_type)")
      .eq("farm_id", result.farmId)
      .eq("status", "pending")
      .not("due_date", "is", null)
      .order("due_date")
      .limit(MAX_EVENTS),
  ]);

  if (farm.error) return databaseFailure("calendar farm lookup", farm.error);
  if (vaccinations.error) return databaseFailure("calendar vaccinations lookup", vaccinations.error);
  if (crops.error) return databaseFailure("calendar crops lookup", crops.error);
  if (tasks.error && !isMissingTasksTable(tasks.error)) return databaseFailure("calendar tasks lookup", tasks.error);

  const farmName = farm.data?.name || "Mi Campo";
  const calendarVaccinations = (vaccinations.data || []).map((row) => ({
    ...row,
    sections: Array.isArray(row.sections) ? (row.sections[0] || null) : row.sections,
  }));
  const calendarCrops = (crops.data || []).map((row) => ({
    ...row,
    sections: Array.isArray(row.sections) ? (row.sections[0] || null) : row.sections,
  }));
  const calendarTasks = (tasks.error ? [] : tasks.data || []).map((row) => ({
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
  const calendar = toICalendar(events, farmName);

  return new NextResponse(calendar, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": "attachment; filename=\"" + safeFilename(farmName) + "-campoai.ics\"",
      "Cache-Control": "private, no-store",
    },
  });
}
