"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { StatStrip } from "@/components/StatCard";
import { Notice } from "@/components/gestion/Notice";
import { SegmentedControl } from "@/components/gestion/SegmentedControl";
import { LoadingPage } from "@/components/LoadingPage";
import { Button } from "@/components/ui/button";
import { useFarm } from "@/contexts/FarmContext";
import { DATA_CHANGED_EVENT, subscribeToAppEvent } from "@/lib/mutate";
import { BarChart3, RefreshCw, Sparkles } from "lucide-react";
import { fetchWithTimeout } from "@/lib/fetch";
import { isOfflineSnapshotFresh, offlineMetricsSnapshotKey, parseOfflineMetricsSnapshot } from "@/lib/offline";
import { useOfflineSnapshotRefresh } from "@/lib/use-offline-snapshot-refresh";
import { aiChatHandoffKey, buildMetricsChatPrompt } from "@/lib/ai-handoff";
import { useOfflineAwareNavigation } from "@/lib/use-offline-aware-navigation";
import { formatAmount } from "@/lib/format";

// ─── Types ──────────────────────────────────

interface MetricsData {
  metricsTruncated?: boolean;
  truncatedSources?: string[];
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
    primaryCurrency: string;
    financialByCurrency: { currency: string; income: number; expenses: number; net: number }[];
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
    financial: { month: string; currency: string; income: number; expenses: number }[];
    health: { month: string; count: number }[];
  };
}

// ─── Constants ──────────────────────────────

const PAGE_DESCRIPTION = "Indicadores y tendencias del campo en el período elegido.";

const TYPES = [
  { value: "general", label: "General" },
  { value: "livestock", label: "Ganadería" },
  { value: "crops", label: "Agricultura" },
];

const PERIODS = [
  { value: "30d", label: "30 días" },
  { value: "90d", label: "90 días" },
  { value: "year", label: "Año" },
];

// Chart series are neutral: the bars compare magnitudes, they are not states.
const INCOME_FILL = "var(--primary)";
const EXPENSE_FILL = "var(--muted-foreground)";

const METRIC_SOURCE_LABELS: Record<string, string> = {
  cattle: "hacienda",
  sections: "secciones",
  crops: "cultivos",
  inventory: "inventario",
  financial: "finanzas",
  vaccinations: "vacunaciones",
  health: "eventos sanitarios",
};

const BarTrendChart = dynamic(() => import("@/components/charts/BarTrendChart"), {
  ssr: false,
  loading: () => <div className="h-[200px] animate-pulse rounded-lg bg-muted" />,
});

// ─── Page Component ─────────────────────────

export default function MetricasPage() {
  const { offlineMode, isOnline, userId } = useFarm();
  const navigate = useOfflineAwareNavigation();
  const readOnly = offlineMode || !isOnline;
  const [data, setData] = useState<MetricsData | null>(null);
  const [type, setType] = useState("general");
  const [period, setPeriod] = useState("90d");
  const [error, setError] = useState<string | null>(null);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const requestId = useRef(0);
  const metricsRequestRef = useRef<AbortController | null>(null);

  const loadMetrics = useCallback(async () => {
    const currentRequest = ++requestId.current;
    metricsRequestRef.current?.abort();
    if (readOnly) {
      let snapshot = null;
      try {
        snapshot = userId
          ? parseOfflineMetricsSnapshot(window.localStorage.getItem(offlineMetricsSnapshotKey(userId, type, period)))
          : null;
      } catch {
        snapshot = null;
      }
      if (snapshot && snapshot.type === type && snapshot.period === period && isOfflineSnapshotFresh(snapshot.savedAt)) {
        setData(snapshot.data as MetricsData);
        setSyncedAt(snapshot.savedAt);
        setError(null);
      } else {
        setData(null);
        setSyncedAt(null);
        setError("Las métricas requieren conexión y todavía no hay una copia local disponible para este filtro.");
      }
      return;
    }
    setError(null);
    const controller = new AbortController();
    metricsRequestRef.current = controller;
    try {
      const res = await fetchWithTimeout(`/api/metrics?type=${type}&period=${period}`, { cache: "no-store", signal: controller.signal }, 8000);
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof payload.error === "string" ? payload.error : "No se pudieron cargar las métricas.");
      if (currentRequest !== requestId.current || controller.signal.aborted) return;
      setError(null);
      setData(payload);
      const savedAt = new Date().toISOString();
      setSyncedAt(savedAt);
      if (userId) {
        try {
          window.localStorage.setItem(offlineMetricsSnapshotKey(userId, type, period), JSON.stringify({
            data: payload,
            type,
            period,
            savedAt,
          }));
        } catch {
          // Private browsing and storage limits must not block online metrics.
        }
      }
    } catch (e) {
      if (controller.signal.aborted) return;
      console.error("Load metrics error:", e);
      if (currentRequest !== requestId.current) return;
      setError(e instanceof Error ? e.message : "No se pudieron cargar las métricas.");
    } finally {
      if (currentRequest === requestId.current && metricsRequestRef.current === controller) metricsRequestRef.current = null;
    }
  }, [period, readOnly, type, userId]);

  useEffect(() => {
    void loadMetrics();
    return () => {
      requestId.current += 1;
      metricsRequestRef.current?.abort();
    };
  }, [loadMetrics]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onDataChanged = () => {
      if (readOnly) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { void loadMetrics(); }, 300);
    };
    const unsubscribe = subscribeToAppEvent(DATA_CHANGED_EVENT, onDataChanged);
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [loadMetrics, readOnly]);
  useOfflineSnapshotRefresh(loadMetrics, userId, readOnly);

  if (!data && error) {
    return (
      <div className="space-y-6">
        <PageHeader title="Métricas" description={PAGE_DESCRIPTION} />
        <EmptyState
          icon={BarChart3}
          title={readOnly ? "Métricas no disponibles sin conexión" : "No se pudieron cargar las métricas"}
          description={error || "Revisá tu conexión e intentá nuevamente."}
          actionLabel={readOnly ? undefined : "Reintentar"}
          onAction={readOnly ? undefined : () => void loadMetrics()}
        />
      </div>
    );
  }

  if (!data) {
    return <LoadingPage />;
  }
  const metrics = data;

  const isEmpty =
    data.snapshot.totalHeads === 0 &&
    data.snapshot.totalPlantedHa === 0 &&
    data.snapshot.income === 0 &&
    data.snapshot.expenses === 0;

  if (isEmpty) {
    return (
      <div className="space-y-6">
        <PageHeader title="Métricas" description={PAGE_DESCRIPTION} />
        <EmptyState
          icon={BarChart3}
          title="Todavía no hay datos para medir"
          description="Cargá hacienda, cultivos o movimientos de Finanzas para empezar a ver tus métricas."
        />
      </div>
    );
  }

  const showLivestock = type === "general" || type === "livestock";
  const showCrops = type === "general" || type === "crops";
  const primaryFinancialTrend = data.trends.financial.filter((t) => t.currency === data.snapshot.primaryCurrency);

  function askCampoAI() {
    if (!userId || readOnly) return;
    const facts = [
      `Cabezas: ${metrics.snapshot.totalHeads}`,
      `Hectáreas plantadas: ${metrics.snapshot.totalPlantedHa.toFixed(1)}`,
      `Stock bajo: ${metrics.snapshot.lowStockItems}`,
      `Vacunas vencidas: ${metrics.snapshot.overdueVax}`,
      `Eventos sanitarios sin resolver: ${metrics.snapshot.unresolvedHealth}`,
      ...metrics.snapshot.financialByCurrency.map((row) => `${row.currency}: ingresos ${row.income}, egresos ${row.expenses}, resultado ${row.net}`),
      `Carga ganadera: ${metrics.livestock.stockingRate.toFixed(2)} cab/ha`,
      `Mortalidad: ${metrics.livestock.mortalityRate.toFixed(1)}%`,
      `Rinde promedio: ${metrics.crops.avgYield.toFixed(0)} kg/ha`,
      `Cultivos activos: ${metrics.crops.activeCrops}`,
      ...primaryFinancialTrend.slice(-6).map((row) => `Tendencia ${row.month} ${row.currency}: ingresos ${row.income}, egresos ${row.expenses}`),
      ...metrics.trends.health.slice(-6).map((row) => `Eventos sanitarios ${row.month}: ${row.count}`),
    ];
    try {
      window.sessionStorage.setItem(aiChatHandoffKey(userId), buildMetricsChatPrompt({
        title: `${TYPES.find((item) => item.value === type)?.label || type} · ${PERIODS.find((item) => item.value === period)?.label || period}`,
        facts,
        partial: metrics.metricsTruncated,
      }));
    } catch {
      // Chat remains available even when session storage is unavailable.
    }
    navigate("/chat?from=metrics");
  }

  const headerActions = (
    <>
      <Button variant="outline" onClick={askCampoAI} disabled={readOnly} title={readOnly ? "Necesitás conexión para consultar a CampoAI" : undefined}>
        <Sparkles className="h-4 w-4" aria-hidden="true" /> Analizar con CampoAI
      </Button>
      <Button variant="ghost" onClick={() => void loadMetrics()} disabled={readOnly}>
        <RefreshCw className="h-4 w-4" aria-hidden="true" /> Actualizar
      </Button>
    </>
  );
  const lowStock = data.snapshot.lowStockItems;
  const overdueVax = data.snapshot.overdueVax;

  return (
    <div className="space-y-8">
      <PageHeader title="Métricas" description={PAGE_DESCRIPTION} actions={headerActions} />

      {(readOnly && syncedAt) || data.metricsTruncated ? (
        <div className="space-y-3">
          {readOnly && syncedAt && (
            <Notice title="Métricas en modo lectura">
              Mostrando una copia guardada el {new Date(syncedAt).toLocaleString("es-UY", { dateStyle: "short", timeStyle: "short" })}. Se actualizan al recuperar la conexión.
            </Notice>
          )}
          {data.metricsTruncated && (
            <Notice tone="warn">
              Estas métricas son parciales porque algunas fuentes superan las 5.000 filas: {data.truncatedSources?.map((source) => METRIC_SOURCE_LABELS[source] || source).join(", ") || "revisá los módulos de detalle"}. Consultá esos módulos para ver el historial completo.
            </Notice>
          )}
        </div>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SegmentedControl label="Tipo de métricas" options={TYPES} value={type} onChange={setType} />
        <SegmentedControl label="Período" options={PERIODS} value={period} onChange={setPeriod} />
      </div>

      <section aria-labelledby="metricas-estado" className="space-y-3">
        <h2 id="metricas-estado" className="text-base font-semibold">Estado actual</h2>
        <StatStrip
          items={[
            { label: "Hacienda", value: data.snapshot.totalHeads.toLocaleString("es-UY"), unit: "cab." },
            { label: "Superficie sembrada", value: data.snapshot.totalPlantedHa.toLocaleString("es-UY", { maximumFractionDigits: 1 }), unit: "ha" },
            { label: "Stock bajo", value: lowStock, unit: lowStock === 1 ? "insumo" : "insumos", tone: lowStock > 0 ? "bad" : undefined },
            { label: "Vacunas vencidas", value: overdueVax, tone: overdueVax > 0 ? "bad" : undefined },
          ]}
        />
      </section>

      <section aria-labelledby="metricas-finanzas" className="space-y-3">
        <h2 id="metricas-finanzas" className="text-base font-semibold">Resumen financiero</h2>
        {data.snapshot.financialByCurrency.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            No hay movimientos de Finanzas en este período.
          </p>
        ) : (
          <div className="space-y-3">
            {data.snapshot.financialByCurrency.map((summary) => (
              <StatStrip
                key={summary.currency}
                items={[
                  { label: "Ingresos", value: formatAmount(summary.income), unit: summary.currency },
                  { label: "Egresos", value: formatAmount(summary.expenses), unit: summary.currency },
                  {
                    label: "Resultado",
                    value: `${summary.net > 0 ? "+" : summary.net < 0 ? "−" : ""}${formatAmount(Math.abs(summary.net))}`,
                    unit: summary.currency,
                    tone: summary.net > 0 ? "ok" : summary.net < 0 ? "bad" : undefined,
                  },
                ]}
              />
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="metricas-tendencias" className="space-y-3">
        <h2 id="metricas-tendencias" className="text-base font-semibold">Tendencias</h2>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="min-w-0 rounded-lg border border-border bg-card p-4">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h3 className="text-sm font-medium">Ingresos y egresos por mes <span className="font-normal text-muted-foreground">({data.snapshot.primaryCurrency})</span></h3>
              <ChartLegend items={[{ label: "Ingresos", swatch: "bg-primary" }, { label: "Egresos", swatch: "bg-muted-foreground" }]} />
            </div>
            {primaryFinancialTrend.length > 0 ? (
              <BarTrendChart
                data={primaryFinancialTrend}
                xKey="month"
                bars={[
                  { dataKey: "income", fill: INCOME_FILL },
                  { dataKey: "expenses", fill: EXPENSE_FILL },
                ]}
              />
            ) : (
              <p className="py-8 text-center text-xs text-muted-foreground">
                No hay movimientos en {data.snapshot.primaryCurrency} para graficar.
              </p>
            )}
          </div>

          <div className="min-w-0 rounded-lg border border-border bg-card p-4">
            <h3 className="mb-3 text-sm font-medium">Eventos sanitarios por mes</h3>
            {data.trends.health.length > 0 ? (
              <BarTrendChart
                data={data.trends.health}
                xKey="month"
                bars={[{ dataKey: "count", fill: INCOME_FILL }]}
              />
            ) : (
              <p className="py-8 text-center text-xs text-muted-foreground">
                No hay eventos sanitarios en este período.
              </p>
            )}
          </div>
        </div>
      </section>

      {showLivestock && (
        <section aria-labelledby="metricas-ganaderia" className="space-y-3">
          <h2 id="metricas-ganaderia" className="text-base font-semibold">Ganadería</h2>
          <StatStrip
            items={[
              { label: "Carga", value: data.livestock.stockingRate.toLocaleString("es-UY", { minimumFractionDigits: 2, maximumFractionDigits: 2 }), unit: "cab./ha" },
              { label: "Mortalidad", value: data.livestock.mortalityRate.toLocaleString("es-UY", { minimumFractionDigits: 1, maximumFractionDigits: 1 }), unit: "%", tone: data.livestock.mortalityRate > 2 ? "bad" : undefined },
              { label: "Total de cabezas", value: data.livestock.totalHeads.toLocaleString("es-UY"), unit: "cab." },
            ]}
          />
        </section>
      )}

      {showCrops && (
        <section aria-labelledby="metricas-agricultura" className="space-y-3">
          <h2 id="metricas-agricultura" className="text-base font-semibold">Agricultura</h2>
          <StatStrip
            items={[
              { label: "Rinde promedio", value: Math.round(data.crops.avgYield).toLocaleString("es-UY"), unit: "kg/ha" },
              { label: "Cultivos activos", value: data.crops.activeCrops },
              { label: "Cosechados", value: data.crops.harvestedCount },
            ]}
          />
        </section>
      )}
    </div>
  );
}

function ChartLegend({ items }: { items: { label: string; swatch: string }[] }) {
  return (
    <ul className="flex gap-3 text-xs text-muted-foreground">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span className={`h-2.5 w-2.5 rounded-sm ${item.swatch}`} aria-hidden="true" />
          {item.label}
        </li>
      ))}
    </ul>
  );
}
