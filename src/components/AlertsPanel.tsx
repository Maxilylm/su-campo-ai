"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Alert, AlertKind } from "@/lib/alerts";
import { toneTint, alertSeverityTone } from "@/lib/status-styles";
import { Syringe, Package, Stethoscope, Wheat, ChevronRight, CheckCircle2 } from "lucide-react";

const ICONS: Record<AlertKind, typeof Syringe> = {
  vaccination: Syringe,
  stock: Package,
  health: Stethoscope,
  harvest: Wheat,
};

export function AlertsPanel() {
  const router = useRouter();
  const [alerts, setAlerts] = useState<Alert[] | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/alerts")
      .then((r) => (r.ok ? r.json() : { alerts: [] }))
      .then((d) => active && setAlerts(d.alerts || []))
      .catch(() => active && setAlerts([]));
    return () => { active = false; };
  }, []);

  if (alerts === null || alerts.length === 0) {
    return (
      <div className="mb-8 rounded-xl border border-border bg-card p-5 flex items-center gap-3 text-sm text-muted-foreground">
        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
        {alerts === null ? "Revisando pendientes…" : "Todo al día — sin pendientes."}
      </div>
    );
  }

  return (
    <div className="mb-8">
      <h2 className="text-lg font-medium mb-3">Pendientes <span className="text-muted-foreground text-sm">({alerts.length})</span></h2>
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
