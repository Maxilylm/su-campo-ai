import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireFarm } from "@/lib/auth";
import { databaseFailure } from "@/lib/api-error";
import { withTimeout } from "@/lib/timeout";
import { averageValidCropYield, countActiveCrops, countOverdueDates } from "@/lib/metrics";
import { splitPage } from "@/lib/pagination";

const METRICS_TIMEOUT_MS = 7500;
const MAX_METRIC_ROWS = 5000;

type MetricsQueryResult = {
  data: Array<Record<string, unknown>> | null;
  error: { message?: string } | null;
  count?: number | null;
};

function getPeriodDate(period: string): string {
  const now = new Date();
  switch (period) {
    case "30d":
      now.setDate(now.getDate() - 30);
      break;
    case "year":
      now.setFullYear(now.getFullYear() - 1);
      break;
    default: // 90d
      now.setDate(now.getDate() - 90);
  }
  return now.toISOString().slice(0, 10);
}

function toMonth(dateStr: string): string {
  return dateStr.slice(0, 7); // "YYYY-MM"
}

export async function GET(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const period = req.nextUrl.searchParams.get("period") || "90d";
  const dateFilter = getPeriodDate(period);
  const db = getSupabaseAdmin();

  // Fetch only the columns used by the calculations. Metrics should remain
  // responsive as the farm grows instead of shipping complete rows from
  // seven tables to a serverless function.
  let queryResults: MetricsQueryResult[] | null;
  try {
    queryResults = await withTimeout(
      Promise.all([
        db.from("cattle").select("count", { count: "exact" }).eq("farm_id", result.farmId).limit(MAX_METRIC_ROWS + 1),
        db.from("sections").select("size_hectares", { count: "exact" }).eq("farm_id", result.farmId).limit(MAX_METRIC_ROWS + 1),
        db.from("crops").select("status, planted_hectares, yield_kg", { count: "exact" }).eq("farm_id", result.farmId).limit(MAX_METRIC_ROWS + 1),
        db.from("inventory_items").select("current_stock, min_stock", { count: "exact" }).eq("farm_id", result.farmId).limit(MAX_METRIC_ROWS + 1),
        db.from("financial_transactions").select("date, type, amount, currency", { count: "exact" }).eq("farm_id", result.farmId).gte("date", dateFilter).limit(MAX_METRIC_ROWS + 1),
        db.from("vaccinations").select("next_due", { count: "exact" }).eq("farm_id", result.farmId).limit(MAX_METRIC_ROWS + 1),
        db.from("health_events").select("type, resolved, date_occurred", { count: "exact" }).eq("farm_id", result.farmId).limit(MAX_METRIC_ROWS + 1),
      ]) as Promise<MetricsQueryResult[]>,
      METRICS_TIMEOUT_MS,
      null,
    );
  } catch (error) {
    return databaseFailure("metrics queries", error as { message?: string });
  }

  if (!queryResults) {
    return NextResponse.json({ error: "Las métricas tardaron demasiado. Intentá nuevamente." }, { status: 504 });
  }

  const [cattleRes, sectionsRes, cropsRes, inventoryRes, financialRes, vaxRes, healthRes] = queryResults;

  const failedQuery = [cattleRes, sectionsRes, cropsRes, inventoryRes, financialRes, vaxRes, healthRes]
    .find((query) => query.error);
  if (failedQuery?.error) {
    return databaseFailure("metrics query", failedQuery.error);
  }

  const boundedSource = (query: MetricsQueryResult) => {
    const page = splitPage(query.data || [], MAX_METRIC_ROWS);
    return {
      data: page.items,
      truncated: page.hasMore || (query.count ?? 0) > MAX_METRIC_ROWS,
    };
  };
  const sources = [
    ["cattle", cattleRes],
    ["sections", sectionsRes],
    ["crops", cropsRes],
    ["inventory", inventoryRes],
    ["financial", financialRes],
    ["vaccinations", vaxRes],
    ["health", healthRes],
  ] as const;
  const bounded = sources.map(([name, query]) => [name, boundedSource(query)] as const);
  const truncatedSources = bounded.filter(([, source]) => source.truncated).map(([name]) => name);
  const dataFor = <T extends Record<string, unknown>>(name: (typeof sources)[number][0]) =>
    (bounded.find(([sourceName]) => sourceName === name)?.[1].data || []) as T[];
  const cattleData = dataFor("cattle");
  const sectionsData = dataFor("sections");
  const cropsData = dataFor("crops");
  const inventoryData = dataFor("inventory");
  const financialData = dataFor("financial");
  const vaxData = dataFor("vaccinations");
  const healthData = dataFor("health");

  // ─── Snapshot calculations ─────────────────

  const totalHeads = cattleData.reduce(
    (s: number, c: { count?: number }) => s + (c.count || 0),
    0
  );

  const totalPlantedHa = cropsData.reduce(
    (s: number, c: { planted_hectares?: number }) => s + (c.planted_hectares || 0),
    0
  );

  const totalSectionHa = sectionsData.reduce(
    (s: number, sec: { size_hectares?: number }) => s + (sec.size_hectares || 0),
    0
  );

  const lowStockItems = inventoryData.filter(
    (i: { current_stock?: number; min_stock?: number | null }) =>
      i.min_stock != null && (i.current_stock || 0) < i.min_stock
  ).length;

  const today = new Date().toISOString().slice(0, 10);
  const overdueVax = countOverdueDates(vaxData.map((v) => typeof v.next_due === "string" ? v.next_due : null), today);

  const unresolvedHealth = healthData.filter(
    (h: { resolved?: boolean }) => !h.resolved
  ).length;

  const financialByCurrency: Record<string, { income: number; expenses: number }> = {};
  for (const t of financialData as { type: string; amount: number; currency?: string }[]) {
    const currency = t.currency || "USD";
    financialByCurrency[currency] ||= { income: 0, expenses: 0 };
    if (t.type === "ingreso") financialByCurrency[currency].income += t.amount;
    if (t.type === "egreso") financialByCurrency[currency].expenses += t.amount;
  }
  const currencies = Object.keys(financialByCurrency).sort();
  const primaryCurrency = currencies.includes("USD") ? "USD" : currencies[0] || "USD";
  const income = financialByCurrency[primaryCurrency]?.income || 0;
  const expenses = financialByCurrency[primaryCurrency]?.expenses || 0;

  const margin = income > 0 ? ((income - expenses) / income) * 100 : 0;

  // ─── Livestock metrics ─────────────────────

  const recentHealthData = healthData.filter(
    (h: { date_occurred?: string }) => typeof h.date_occurred === "string" && h.date_occurred.slice(0, 10) >= dateFilter
  );

  const deaths = recentHealthData.filter(
    (h: { type?: string }) => h.type === "muerte"
  ).length;

  const stockingRate = totalSectionHa > 0 ? totalHeads / totalSectionHa : 0;
  const mortalityRate =
    totalHeads + deaths > 0
      ? (deaths / (totalHeads + deaths)) * 100
      : 0;

  // ─── Crop metrics ─────────────────────────

  const harvestedCrops = cropsData.filter(
    (c: { status?: string }) => c.status === "harvested"
  );

  const avgYield = averageValidCropYield(harvestedCrops);

  const activeCrops = countActiveCrops(cropsData);

  // ─── Trends ────────────────────────────────

  const financialByMonth: Record<string, { currency: string; income: number; expenses: number }> = {};
  for (const t of financialData as { date: string; type: string; amount: number; currency?: string }[]) {
    const currency = t.currency || "USD";
    const month = toMonth(t.date);
    const key = `${currency}:${month}`;
    if (!financialByMonth[key]) financialByMonth[key] = { currency, income: 0, expenses: 0 };
    if (t.type === "ingreso") financialByMonth[key].income += t.amount;
    if (t.type === "egreso") financialByMonth[key].expenses += t.amount;
  }

  const financialTrends = Object.entries(financialByMonth)
    .map(([key, data]) => ({ month: key.slice(key.indexOf(":") + 1), ...data }))
    .sort((a, b) => a.month.localeCompare(b.month) || a.currency.localeCompare(b.currency));

  const healthByMonth: Record<string, number> = {};
  for (const h of recentHealthData as { date_occurred: string }[]) {
    const month = toMonth(h.date_occurred);
    healthByMonth[month] = (healthByMonth[month] || 0) + 1;
  }

  const healthTrends = Object.entries(healthByMonth)
    .map(([month, count]) => ({ month, count }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const response = NextResponse.json({
    metricsTruncated: truncatedSources.length > 0,
    truncatedSources,
    snapshot: {
      totalHeads,
      totalPlantedHa,
      totalSectionHa,
      lowStockItems,
      overdueVax,
      unresolvedHealth,
      income,
      expenses,
      margin,
      primaryCurrency,
      financialByCurrency: currencies.map((currency) => ({
        currency,
        income: financialByCurrency[currency].income,
        expenses: financialByCurrency[currency].expenses,
        net: financialByCurrency[currency].income - financialByCurrency[currency].expenses,
      })),
    },
    livestock: {
      stockingRate,
      mortalityRate,
      totalHeads,
    },
    crops: {
      avgYield,
      harvestedCount: harvestedCrops.length,
      activeCrops,
    },
    trends: {
      financial: financialTrends,
      health: healthTrends,
    },
  });
  response.headers.set("X-CampoAI-Metrics-Limit", String(MAX_METRIC_ROWS));
  if (truncatedSources.length > 0) response.headers.set("X-CampoAI-Metrics-Truncated", "true");
  return response;
}
