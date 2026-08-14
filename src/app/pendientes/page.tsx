"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useFarm } from "@/contexts/FarmContext";
import { filterAlerts, type AlertFilter, type AlertKind } from "@/lib/alerts";
import { alertSeverityTone, toneTint } from "@/lib/status-styles";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { LoadingPage } from "@/components/LoadingPage";
import { LoadErrorState } from "@/components/LoadErrorState";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle, Bell, CheckCircle2, ChevronRight, CloudRain,
  ClipboardCheck, Package, RefreshCw, Stethoscope, Syringe, Wheat,
} from "lucide-react";

const ICONS: Record<AlertKind, typeof Bell> = {
  vaccination: Syringe,
  stock: Package,
  health: Stethoscope,
  harvest: Wheat,
  weather: CloudRain,
  task: ClipboardCheck,
};

const FILTERS: { value: AlertFilter; label: string }[] = [
  { value: "all", label: "Todos" },
  { value: "vaccination", label: "Vacunación" },
  { value: "stock", label: "Stock" },
  { value: "health", label: "Sanidad" },
  { value: "harvest", label: "Cosecha" },
  { value: "weather", label: "Clima" },
  { value: "task", label: "Tareas" },
];

export default function PendientesPage() {
  const router = useRouter();
  const { alerts, alertsLoaded, alertsError, error, refreshAlerts } = useFarm();
  const [filter, setFilter] = useState<AlertFilter>("all");
  const [refreshing, setRefreshing] = useState(false);
  const filteredAlerts = useMemo(() => filterAlerts(alerts, filter), [alerts, filter]);

  async function refresh() {
    setRefreshing(true);
    try {
      await refreshAlerts();
    } finally {
      setRefreshing(false);
    }
  }

  if (!alertsLoaded && !error) return <LoadingPage />;
  if ((error || alertsError) && alerts.length === 0) return <LoadErrorState title="No se pudieron cargar los pendientes" onRetry={refresh} />;

  const highCount = alerts.filter((alert) => alert.severity === "high").length;

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Pendientes" }]}
        title="Pendientes"
        description="Una vista de las acciones que necesitan atención en el campo."
        actions={
          <Button variant="outline" onClick={refresh} disabled={refreshing}>
            <RefreshCw className={`mr-1.5 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            Actualizar
          </Button>
        }
      />

      {alertsError && alerts.length > 0 && (
        <div role="status" className="flex items-center gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
          <span className="flex-1">Mostrando la última actualización disponible.</span>
          <button className="font-medium text-foreground hover:underline" onClick={() => void refresh()}>Reintentar</button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Pendientes</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{alerts.length}</p>
        </div>
        <div className="rounded-xl border border-red-500/25 bg-card p-4">
          <p className="text-xs text-muted-foreground">Urgentes</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-red-600 dark:text-red-400">{highCount}</p>
        </div>
        <div className="col-span-2 rounded-xl border border-emerald-500/25 bg-card p-4 sm:col-span-1">
          <p className="text-xs text-muted-foreground">Estado</p>
          <p className="mt-1 flex items-center gap-1.5 text-sm font-medium">
            {alerts.length === 0 ? <><CheckCircle2 className="h-4 w-4 text-emerald-500" /> Todo al día</> : <><AlertTriangle className="h-4 w-4 text-amber-500" /> Requiere atención</>}
          </p>
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Filtrar pendientes">
        {FILTERS.map((option) => (
          <Button
            key={option.value}
            variant={filter === option.value ? "secondary" : "outline"}
            size="sm"
            role="tab"
            aria-selected={filter === option.value}
            onClick={() => setFilter(option.value)}
            className="shrink-0"
          >
            {option.label}
            {option.value === "all" && <Badge variant="outline" className="ml-1.5 px-1.5">{alerts.length}</Badge>}
          </Button>
        ))}
      </div>

      {filteredAlerts.length === 0 ? (
        <div className="rounded-xl border border-border bg-card">
          <EmptyState
            icon={CheckCircle2}
            title={alerts.length === 0 ? "Todo al día" : "Sin pendientes en este filtro"}
            description={alerts.length === 0 ? "No hay vacunaciones, stock, sanidad, cosechas o tareas que requieran atención." : "Probá con otra categoría para ver las demás acciones."}
          />
        </div>
      ) : (
        <div className="space-y-2">
          {filteredAlerts.map((alert) => {
            const Icon = ICONS[alert.kind];
            const high = alert.severity === "high";
            return (
              <button
                key={alert.id}
                onClick={() => router.push(alert.href)}
                className={`flex w-full items-center gap-3 rounded-xl border bg-card p-4 text-left transition-colors hover:bg-accent ${high ? "border-red-500/30" : "border-amber-500/25"}`}
              >
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${toneTint(alertSeverityTone(alert.severity))}`}>
                  <Icon className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{alert.title}</span>
                    <Badge variant="outline" className="text-[10px] uppercase">{high ? "Urgente" : "Próximo"}</Badge>
                  </span>
                  <span className="mt-1 block text-sm text-muted-foreground">{alert.detail}</span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
