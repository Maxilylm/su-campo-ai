import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireFarm } from "@/lib/auth";

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

  // Fetch all data in parallel
  const [cattleRes, sectionsRes, cropsRes, inventoryRes, financialRes, vaxRes, healthRes] =
    await Promise.all([
      db.from("cattle").select("*").eq("farm_id", result.farmId),
      db.from("sections").select("*").eq("farm_id", result.farmId),
      db.from("crops").select("*").eq("farm_id", result.farmId),
      db.from("inventory_items").select("*").eq("farm_id", result.farmId),
      db.from("financial_transactions").select("*").eq("farm_id", result.farmId).gte("date", dateFilter),
      db.from("vaccinations").select("*").eq("farm_id", result.farmId),
      db.from("health_events").select("*").eq("farm_id", result.farmId).gte("date_occurred", dateFilter),
    ]);

  if ([cattleRes, sectionsRes, cropsRes, inventoryRes, financialRes, vaxRes, healthRes].some((query) => query.error)) {
    return NextResponse.json({ error: "No se pudieron cargar las métricas." }, { status: 503 });
  }

  const cattleData = cattleRes.data || [];
  const sectionsData = sectionsRes.data || [];
  const cropsData = cropsRes.data || [];
  const inventoryData = inventoryRes.data || [];
  const financialData = financialRes.data || [];
  const vaxData = vaxRes.data || [];
  const healthData = healthRes.data || [];

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

  const now = new Date().toISOString();
  const overdueVax = vaxData.filter(
    (v: { next_due?: string | null }) => v.next_due && v.next_due < now
  ).length;

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

  const deaths = healthData.filter(
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

  const avgYield =
    harvestedCrops.length > 0
      ? harvestedCrops.reduce(
          (s: number, c: { yield_kg?: number; planted_hectares?: number }) => {
            const yph =
              c.yield_kg && c.planted_hectares && c.planted_hectares > 0
                ? c.yield_kg / c.planted_hectares
                : 0;
            return s + yph;
          },
          0
        ) / harvestedCrops.length
      : 0;

  const activeCrops = cropsData.filter(
    (c: { status?: string }) => c.status !== "harvested"
  ).length;

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
  for (const h of healthData as { date_occurred: string }[]) {
    const month = toMonth(h.date_occurred);
    healthByMonth[month] = (healthByMonth[month] || 0) + 1;
  }

  const healthTrends = Object.entries(healthByMonth)
    .map(([month, count]) => ({ month, count }))
    .sort((a, b) => a.month.localeCompare(b.month));

  return NextResponse.json({
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
}
