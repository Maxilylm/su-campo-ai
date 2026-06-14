import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireFarm } from "@/lib/auth";
import { toCSV } from "@/lib/csv";

// Tables that belong to a farm and are safe to export.
const TABLES = [
  "sections", "cattle", "activities", "vaccinations", "health_events",
  "crops", "crop_applications", "inventory_items", "inventory_movements",
  "financial_transactions", "padrones", "map_features",
] as const;

function attach(body: string, filename: string, type: string) {
  return new NextResponse(body, {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

export async function GET(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const db = getSupabaseAdmin();
  const farmId = result.farmId;
  const format = req.nextUrl.searchParams.get("format");
  const table = req.nextUrl.searchParams.get("table");

  // ── Single-table CSV ──
  if (format === "csv") {
    if (!table || !TABLES.includes(table as (typeof TABLES)[number])) {
      return NextResponse.json({ error: "Invalid or missing table" }, { status: 400 });
    }
    const { data, error } = await db.from(table).select("*").eq("farm_id", farmId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return attach(toCSV(data || []), `campoai-${table}.csv`, "text/csv; charset=utf-8");
  }

  // ── Full JSON backup ──
  const { data: farm } = await db.from("farms").select("*").eq("id", farmId).single();
  const tableData = await Promise.all(
    TABLES.map((t) => db.from(t).select("*").eq("farm_id", farmId).then((r) => [t, r.data || []] as const))
  );

  const backup = {
    exported_at: new Date().toISOString(),
    farm,
    ...Object.fromEntries(tableData),
  };
  return attach(JSON.stringify(backup, null, 2), "campoai-backup.json", "application/json");
}
