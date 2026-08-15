import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireFarm } from "@/lib/auth";
import { databaseFailure } from "@/lib/api-error";
import { withTimeout } from "@/lib/timeout";
import { financialPeriodStart } from "@/lib/finance-period";

const REPORT_QUERY_TIMEOUT_MS = 7500;
const MAX_REPORT_ROWS = 10_000;

function reportTooLarge(table: string) {
  return NextResponse.json({
    error: `El reporte contiene más de ${MAX_REPORT_ROWS.toLocaleString("es-UY")} registros de ${table}. Exportá los datos por separado para trabajar con el conjunto completo.`,
    code: "report_too_large",
    table,
    limit: MAX_REPORT_ROWS,
  }, { status: 413 });
}

export async function GET(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const period = req.nextUrl.searchParams.get("period") || "year";
  const db = getSupabaseAdmin();
  const queryResults = await withTimeout(
    Promise.all([
      db
        .from("cattle")
        .select("category, count")
        .eq("farm_id", result.farmId)
        .order("category")
        .limit(MAX_REPORT_ROWS + 1),
      db
        .from("financial_transactions")
        .select("type, category, amount, currency, section_id, sections(name)")
        .eq("farm_id", result.farmId)
        .gte("date", financialPeriodStart(period))
        .order("date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(MAX_REPORT_ROWS + 1),
      db
        .from("inventory_items")
        .select("name, current_stock, cost_per_unit, unit, currency")
        .eq("farm_id", result.farmId)
        .order("category")
        .order("name")
        .limit(MAX_REPORT_ROWS + 1),
    ]),
    REPORT_QUERY_TIMEOUT_MS,
    null,
  );

  if (!queryResults) return NextResponse.json({ error: "Los reportes tardaron demasiado. Intentá nuevamente." }, { status: 504 });
  const [cattle, transactions, inventory] = queryResults;
  if (cattle.error) return databaseFailure("reports cattle", cattle.error);
  if (transactions.error) return databaseFailure("reports financial", transactions.error);
  if (inventory.error) return databaseFailure("reports inventory", inventory.error);
  if ((cattle.data || []).length > MAX_REPORT_ROWS) return reportTooLarge("hacienda");
  if ((transactions.data || []).length > MAX_REPORT_ROWS) return reportTooLarge("finanzas");
  if ((inventory.data || []).length > MAX_REPORT_ROWS) return reportTooLarge("inventario");

  return NextResponse.json({
    cattle: cattle.data || [],
    transactions: transactions.data || [],
    inventory: inventory.data || [],
    period,
    complete: true,
  }, {
    headers: { "X-CampoAI-Reports-Limit": String(MAX_REPORT_ROWS) },
  });
}
