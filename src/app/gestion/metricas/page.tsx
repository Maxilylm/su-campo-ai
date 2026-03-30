"use client";

import { useState, useEffect, useCallback } from "react";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";
import { LoadingPage } from "@/components/LoadingPage";
import { Button } from "@/components/ui/button";
import {
  Beef,
  Wheat,
  AlertTriangle,
  Syringe,
  TrendingUp,
  TrendingDown,
  BarChart3,
  Percent,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";

// ─── Types ──────────────────────────────────

interface MetricsData {
  snapshot: {
    totalHeads: number;
    totalPlantedHa: number;
    totalSectionHa: number;
    lowStockItems: number;
    overdueVax: number;
    unresolvedHealth: number;
    income: number;
    expenses: number;
    margin: number;
  };
  livestock: {
    stockingRate: number;
    mortalityRate: number;
    totalHeads: number;
  };
  crops: {
    avgYield: number;
    harvestedCount: number;
    activeCrops: number;
  };
  trends: {
    financial: { month: string; income: number; expenses: number }[];
    health: { month: string; count: number }[];
  };
}

// ─── Constants ──────────────────────────────

const TYPES = [
  { value: "general", label: "General" },
  { value: "livestock", label: "Ganaderia" },
  { value: "crops", label: "Agricultura" },
];

const PERIODS = [
  { value: "30d", label: "30d" },
  { value: "90d", label: "90d" },
  { value: "year", label: "Ano" },
];

// ─── Chart tooltip style ────────────────────

const tooltipStyle = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "8px",
  fontSize: "12px",
};
const tooltipLabelStyle = { color: "hsl(var(--muted-foreground))" };

// ─── Page Component ─────────────────────────

export default function MetricasPage() {
  const [data, setData] = useState<MetricsData | null>(null);
  const [type, setType] = useState("general");
  const [period, setPeriod] = useState("90d");

  const loadMetrics = useCallback(async () => {
    try {
      const res = await fetch(`/api/metrics?type=${type}&period=${period}`);
      if (res.ok) setData(await res.json());
    } catch (e) {
      console.error("Load metrics error:", e);
    }
  }, [type, period]);

  useEffect(() => {
    loadMetrics();
  }, [loadMetrics]);

  if (!data) {
    return <LoadingPage />;
  }

  const showLivestock = type === "general" || type === "livestock";
  const showCrops = type === "general" || type === "crops";

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[
          { label: "Gestion", href: "/gestion/inventario" },
          { label: "Metricas" },
        ]}
        title="Metricas"
        description="KPIs, tendencias y analisis del campo"
      />

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex gap-2">
          {TYPES.map((t) => (
            <Button
              key={t.value}
              variant={type === t.value ? "secondary" : "outline"}
              size="sm"
              onClick={() => setType(t.value)}
            >
              {t.label}
            </Button>
          ))}
        </div>
        <div className="h-4 w-px bg-border" />
        <div className="flex gap-2">
          {PERIODS.map((p) => (
            <Button
              key={p.value}
              variant={period === p.value ? "secondary" : "outline"}
              size="sm"
              onClick={() => setPeriod(p.value)}
            >
              {p.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Snapshot: Estado Actual */}
      <div>
        <h3 className="text-lg font-medium mb-4">Estado Actual</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard
            label="Cabezas"
            value={data.snapshot.totalHeads}
            accent="emerald"
            icon={Beef}
          />
          <StatCard
            label="Ha plantadas"
            value={data.snapshot.totalPlantedHa.toFixed(1)}
            accent="blue"
            icon={Wheat}
          />
          <StatCard
            label="Stock bajo"
            value={data.snapshot.lowStockItems}
            accent={data.snapshot.lowStockItems > 0 ? "red" : "emerald"}
            icon={AlertTriangle}
          />
          <StatCard
            label="Vacunas vencidas"
            value={data.snapshot.overdueVax}
            accent={data.snapshot.overdueVax > 0 ? "red" : "emerald"}
            icon={Syringe}
          />
        </div>
      </div>

      {/* Financial summary */}
      <div>
        <h3 className="text-lg font-medium mb-4">Resumen Financiero</h3>
        <div className="grid grid-cols-3 gap-3">
          <StatCard
            label="Ingresos"
            value={`$${data.snapshot.income.toLocaleString()}`}
            accent="emerald"
            icon={TrendingUp}
          />
          <StatCard
            label="Egresos"
            value={`$${data.snapshot.expenses.toLocaleString()}`}
            accent="red"
            icon={TrendingDown}
          />
          <StatCard
            label="Margen"
            value={`${data.snapshot.margin.toFixed(1)}%`}
            accent="amber"
            icon={Percent}
          />
        </div>
      </div>

      {/* Trends */}
      <div>
        <h3 className="text-lg font-medium mb-4">Tendencias</h3>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Financial trend chart */}
          <div className="rounded-xl border border-border bg-card p-5">
            <h4 className="text-sm font-medium text-muted-foreground mb-3">
              Ingresos vs Egresos por mes
            </h4>
            {data.trends.financial.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={data.trends.financial}>
                  <XAxis
                    dataKey="month"
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                    axisLine={{ stroke: "hsl(var(--border))" }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                    axisLine={{ stroke: "hsl(var(--border))" }}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    labelStyle={tooltipLabelStyle}
                  />
                  <Bar dataKey="income" fill="#34d399" radius={[4, 4, 0, 0]} />
                  <Bar
                    dataKey="expenses"
                    fill="#f87171"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-center text-muted-foreground text-xs py-8">
                Sin datos financieros
              </div>
            )}
          </div>

          {/* Health events trend chart */}
          <div className="rounded-xl border border-border bg-card p-5">
            <h4 className="text-sm font-medium text-muted-foreground mb-3">
              Eventos sanitarios por mes
            </h4>
            {data.trends.health.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={data.trends.health}>
                  <XAxis
                    dataKey="month"
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                    axisLine={{ stroke: "hsl(var(--border))" }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                    axisLine={{ stroke: "hsl(var(--border))" }}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    labelStyle={tooltipLabelStyle}
                  />
                  <Bar dataKey="count" fill="#f87171" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-center text-muted-foreground text-xs py-8">
                Sin eventos sanitarios
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Livestock KPIs */}
      {showLivestock && (
        <div>
          <h3 className="text-lg font-medium mb-4">KPIs Ganaderia</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <StatCard
              label="Carga (cab/ha)"
              value={data.livestock.stockingRate.toFixed(2)}
              accent="emerald"
              icon={BarChart3}
            />
            <StatCard
              label="Mortalidad"
              value={`${data.livestock.mortalityRate.toFixed(1)}%`}
              accent={data.livestock.mortalityRate > 2 ? "red" : "emerald"}
              icon={Percent}
            />
            <StatCard
              label="Total cabezas"
              value={data.livestock.totalHeads}
              accent="blue"
              icon={Beef}
            />
          </div>
        </div>
      )}

      {/* Crop KPIs */}
      {showCrops && (
        <div>
          <h3 className="text-lg font-medium mb-4">KPIs Agricultura</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <StatCard
              label="Rinde prom. (kg/ha)"
              value={data.crops.avgYield.toFixed(0)}
              accent="emerald"
              icon={Wheat}
            />
            <StatCard
              label="Cultivos activos"
              value={data.crops.activeCrops}
              accent="blue"
              icon={Wheat}
            />
            <StatCard
              label="Cosechados"
              value={data.crops.harvestedCount}
              accent="amber"
              icon={BarChart3}
            />
          </div>
        </div>
      )}
    </div>
  );
}
