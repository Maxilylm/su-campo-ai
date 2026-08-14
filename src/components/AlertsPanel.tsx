"use client";

import { useRouter } from "next/navigation";
import { useFarm } from "@/contexts/FarmContext";
import type { AlertKind } from "@/lib/alerts";
import { toneTint, alertSeverityTone } from "@/lib/status-styles";
import { Syringe, Package, Stethoscope, Wheat, CloudRain, ClipboardCheck, ChevronRight, CheckCircle2, ArrowRight, AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

const ICONS: Record<AlertKind, typeof Syringe> = {
  vaccination: Syringe,
  stock: Package,
  health: Stethoscope,
  harvest: Wheat,
  weather: CloudRain,
  task: ClipboardCheck,
};

export function AlertsPanel() {
  const router = useRouter();
  const { alerts, alertsLoaded, alertsError, refreshAlerts } = useFarm();

  if (alertsError && alerts.length === 0) {
    return (
      <div role="alert" className="mb-8 rounded-xl border border-red-500/25 bg-card p-5 flex items-center gap-3 text-sm">
        <AlertTriangle className="h-4 w-4 shrink-0 text-red-500" />
        <span className="flex-1 text-muted-foreground">No se pudieron actualizar los pendientes.</span>
        <Button variant="ghost" size="sm" onClick={() => void refreshAlerts()}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Reintentar
        </Button>
      </div>
    );
  }

  if (!alertsLoaded || alerts.length === 0) {
    return (
      <div className="mb-8 rounded-xl border border-border bg-card p-5 flex items-center gap-3 text-sm text-muted-foreground">
        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
        {!alertsLoaded ? "Revisando pendientes…" : "Todo al día — sin pendientes."}
      </div>
    );
  }

  return (
    <div className="mb-8">
      {alertsError && (
        <div role="status" className="mb-3 flex items-center gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
          <span className="flex-1">Mostrando pendientes anteriores; no se pudo actualizar.</span>
          <button className="font-medium text-foreground hover:underline" onClick={() => void refreshAlerts()}>Reintentar</button>
        </div>
      )}
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-lg font-medium">Pendientes <span className="text-muted-foreground text-sm">({alerts.length})</span></h2>
        <Button variant="ghost" size="sm" onClick={() => router.push("/pendientes")}>
          Ver todos <ArrowRight className="ml-1.5 h-4 w-4" />
        </Button>
      </div>
      <div className="space-y-2">
        {alerts.map((a) => {
          const Icon = ICONS[a.kind];
          const high = a.severity === "high";
          return (
            <button
              key={a.id}
              onClick={() => router.push(a.href)}
              className={`w-full text-left rounded-xl border bg-card p-3.5 flex items-center gap-3 transition-colors hover:bg-accent ${
                high ? "border-red-500/30" : "border-amber-500/25"
              }`}
            >
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${toneTint(alertSeverityTone(a.severity))}`}>
                <Icon className="h-4.5 w-4.5" />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium truncate">{a.title}</span>
                <span className="block text-xs text-muted-foreground truncate">{a.detail}</span>
              </span>
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
