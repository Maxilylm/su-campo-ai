import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireFarm } from "@/lib/auth";
import { toCSV } from "@/lib/csv";
import { databaseFailure } from "@/lib/api-error";
import { EXPORT_TIMEOUT_CODE, isExportTimeout, isMissingTasksTable } from "@/lib/export";
import { withTimeout } from "@/lib/timeout";
import { checkRateLimit } from "@/lib/rate-limit";

// Tables that belong to a farm and are safe to export.
const TABLES = [
  "sections", "cattle", "activities", "vaccinations", "health_events",
  "crops", "crop_applications", "inventory_items", "inventory_movements",
  "financial_transactions", "padrones", "map_features", "tasks",
] as const;
const MAX_EXPORT_ROWS = 50_000;
const EXPORT_QUERY_TIMEOUT_MS = 7_500;
const EXPORT_RATE_LIMIT = { capacity: 3, refillPerSec: 1 / 60 };
const EXPORT_TIMEOUT_ERROR = {
  code: EXPORT_TIMEOUT_CODE,
  message: "Export query timed out",
  details: "",
  hint: "",
  name: "PostgrestError",
  status: 504,
  statusText: "Gateway Timeout",
} as const;
const EXPORT_TIMEOUT_FALLBACK = {
  data: null,
  count: null,
  error: EXPORT_TIMEOUT_ERROR,
  status: 504,
  statusText: "Gateway Timeout",
};

function attach(body: string, filename: string, type: string) {
  return new NextResponse(body, {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

function timeoutResponse() {
  return NextResponse.json({ error: "La exportación tardó demasiado. Intentá nuevamente." }, { status: 504 });
}

export async function GET(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const db = getSupabaseAdmin();
  const farmId = result.farmId;
  const limit = checkRateLimit(`export:${farmId}`, EXPORT_RATE_LIMIT);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Se alcanzó el límite de exportaciones. Esperá un momento e intentá de nuevo." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
    );
  }
  const format = req.nextUrl.searchParams.get("format");
  const table = req.nextUrl.searchParams.get("table");

  // ── Single-table CSV ──
  if (format === "csv") {
    if (!table || !TABLES.includes(table as (typeof TABLES)[number])) {
      return NextResponse.json({ error: "Invalid or missing table" }, { status: 400 });
    }
    const { data, count, error } = await withTimeout(
      db.from(table).select("*", { count: "exact" }).eq("farm_id", farmId).range(0, MAX_EXPORT_ROWS - 1),
      EXPORT_QUERY_TIMEOUT_MS,
      EXPORT_TIMEOUT_FALLBACK,
    );
    if (isExportTimeout(error)) return timeoutResponse();
    if (error && table === "tasks" && isMissingTasksTable(error)) {
      return NextResponse.json({ error: "Aplicá la migración 014_tasks.sql para exportar la agenda." }, { status: 503 });
    }
    if (error) return databaseFailure("export CSV", error);
    if ((count ?? 0) > MAX_EXPORT_ROWS) return NextResponse.json({ error: `La exportación supera el límite de ${MAX_EXPORT_ROWS} filas.` }, { status: 413 });
    return attach(toCSV(data || []), `campoai-${table}.csv`, "text/csv; charset=utf-8");
  }

  // ── Full JSON backup ──
  const { data: farm, error: farmError } = await withTimeout(
    db.from("farms").select("*").eq("id", farmId).single(),
    EXPORT_QUERY_TIMEOUT_MS,
    { data: null, error: EXPORT_TIMEOUT_ERROR, count: null, status: 504, statusText: "Gateway Timeout" },
  );
  if (isExportTimeout(farmError)) return timeoutResponse();
  if (farmError || !farm) {
    return NextResponse.json({ error: "No se pudo exportar el campo." }, { status: 503 });
  }

  const tableResults = await Promise.all(
    TABLES.map(async (t) => {
      const { data, count, error } = await withTimeout(
        db.from(t).select("*", { count: "exact" }).eq("farm_id", farmId).range(0, MAX_EXPORT_ROWS - 1),
        EXPORT_QUERY_TIMEOUT_MS,
        EXPORT_TIMEOUT_FALLBACK,
      );
      const optionalMissing = t === "tasks" && isMissingTasksTable(error);
      return { table: t, data: data || [], count: count || 0, error: optionalMissing ? null : error, optionalMissing };
    })
  );
  if (tableResults.some((result) => isExportTimeout(result.error))) return timeoutResponse();
  if (tableResults.some((result) => result.error)) {
    return NextResponse.json({ error: "No se pudieron leer todos los datos del campo." }, { status: 503 });
  }
  if (tableResults.some((result) => result.count > MAX_EXPORT_ROWS)) {
    return NextResponse.json({ error: `La exportación supera el límite de ${MAX_EXPORT_ROWS} filas por tabla.` }, { status: 413 });
  }

  const backup = {
    exported_at: new Date().toISOString(),
    farm,
    ...Object.fromEntries(tableResults.map(({ table, data }) => [table, data])),
    omitted_tables: tableResults.filter((result) => result.optionalMissing).map((result) => result.table),
  };
  return attach(JSON.stringify(backup, null, 2), "campoai-backup.json", "application/json");
}
