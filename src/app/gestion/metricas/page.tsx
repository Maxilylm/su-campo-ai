"use client";

import { useState, useEffect, useCallback } from "react";
import { StatCard } from "@/components/StatCard";
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
    return (
      <div className="text-center py-12 text-zinc-600">
        <div className="text-4xl mb-2">📊</div>
        <p className="text-sm">Cargando metricas...</p>
      </div>
    );
  }

  const showLivestock = type === "general" || type === "livestock";
  const showCrops = type === "general" || type === "crops";

  return (
    <div className="space-y-6">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex gap-2">
          {TYPES.map((t) => (
            <button
              key={t.value}
              onClick={() => setType(t.value)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                type === t.value
                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                  : "bg-zinc-800 text-zinc-400 border border-zinc-700 hover:border-zinc-600"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="h-4 w-px bg-zinc-700" />
        <div className="flex gap-2">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                period === p.value
                  ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                  : "bg-zinc-800 text-zinc-400 border border-zinc-700 hover:border-zinc-600"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Snapshot: Estado Actual */}
      <div>
        <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">
          Estado Actual
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard
            label="Cabezas"
            value={data.snapshot.totalHeads}
            accent="emerald"
          />
          <StatCard
            label="Ha plantadas"
            value={data.snapshot.totalPlantedHa.toFixed(1)}
            accent="blue"
          />
          <StatCard
            label="Stock bajo"
            value={data.snapshot.lowStockItems}
            accent={data.snapshot.lowStockItems > 0 ? "red" : "emerald"}
          />
          <StatCard
            label="Vacunas vencidas"
            value={data.snapshot.overdueVax}
            accent={data.snapshot.overdueVax > 0 ? "red" : "emerald"}
          />
        </div>
      </div>

      {/* Financial summary */}
      <div>
        <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">
          Resumen Financiero
        </h3>
        <div className="grid grid-cols-3 gap-3">
          <StatCard
            label="Ingresos"
            value={`$${data.snapshot.income.toLocaleString()}`}
            accent="emerald"
          />
          <StatCard
            label="Egresos"
            value={`$${data.snapshot.expenses.toLocaleString()}`}
            accent="red"
          />
          <StatCard
            label="Margen"
            value={`${data.snapshot.margin.toFixed(1)}%`}
            accent="amber"
          />
        </div>
      </div>

      {/* Trends */}
      <div>
        <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">
          Tendencias
        </h3>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Financial trend chart */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
            <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">
              Ingresos vs Egresos por mes
            </h4>
            {data.trends.financial.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={data.trends.financial}>
                  <XAxis
                    dataKey="month"
                    tick={{ fill: "#71717a", fontSize: 11 }}
                    axisLine={{ stroke: "#3f3f46" }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: "#71717a", fontSize: 11 }}
                    axisLine={{ stroke: "#3f3f46" }}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#18181b",
                      border: "1px solid #3f3f46",
                      borderRadius: "8px",
                      fontSize: "12px",
                    }}
                    labelStyle={{ color: "#a1a1aa" }}
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
              <div className="text-center text-zinc-600 text-xs py-8">
                Sin datos financieros
              </div>
            )}
          </div>

          {/* Health events trend chart */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
            <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">
              Eventos sanitarios por mes
            </h4>
            {data.trends.health.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={data.trends.health}>
                  <XAxis
                    dataKey="month"
                    tick={{ fill: "#71717a", fontSize: 11 }}
                    axisLine={{ stroke: "#3f3f46" }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: "#71717a", fontSize: 11 }}
                    axisLine={{ stroke: "#3f3f46" }}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#18181b",
                      border: "1px solid #3f3f46",
                      borderRadius: "8px",
                      fontSize: "12px",
                    }}
                    labelStyle={{ color: "#a1a1aa" }}
                  />
                  <Bar dataKey="count" fill="#f87171" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-center text-zinc-600 text-xs py-8">
                Sin eventos sanitarios
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Livestock KPIs */}
      {showLivestock && (
        <div>
          <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">
            KPIs Ganaderia
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <StatCard
              label="Carga (cab/ha)"
              value={data.livestock.stockingRate.toFixed(2)}
              accent="emerald"
            />
            <StatCard
              label="Mortalidad"
              value={`${data.livestock.mortalityRate.toFixed(1)}%`}
              accent={data.livestock.mortalityRate > 2 ? "red" : "emerald"}
            />
            <StatCard
              label="Total cabezas"
              value={data.livestock.totalHeads}
              accent="blue"
            />
          </div>
        </div>
      )}

      {/* Crop KPIs */}
      {showCrops && (
        <div>
          <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">
            KPIs Agricultura
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <StatCard
              label="Rinde prom. (kg/ha)"
              value={data.crops.avgYield.toFixed(0)}
              accent="emerald"
            />
            <StatCard
              label="Cultivos activos"
              value={data.crops.activeCrops}
              accent="blue"
            />
            <StatCard
              label="Cosechados"
              value={data.crops.harvestedCount}
              accent="amber"
            />
          </div>
        </div>
      )}
    </div>
  );
}
