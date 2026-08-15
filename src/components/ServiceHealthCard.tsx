"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useFarm } from "@/contexts/FarmContext";
import { fetchWithTimeout } from "@/lib/fetch";
import { readHealthCheckedAt, serviceProbe, serviceProbeDetail, serviceProbeLabel, type ServiceKey, type ServiceProbe, type ServiceStatusPayload } from "@/lib/service-status";
import { shouldRefreshAfterForeground } from "@/lib/use-data-changed-refresh";
import { AlertTriangle, CheckCircle2, ClipboardCheck, Database, KeyRound, RefreshCw, ShieldCheck, Sparkles, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";

function probeTone(probe: ServiceProbe): string {
  if (probe === "healthy") return "text-emerald-600 dark:text-emerald-400";
  if (probe === "checking") return "text-muted-foreground";
  return "text-amber-600 dark:text-amber-400";
}

export function ServiceHealthCard() {
  const { isOnline } = useFarm();
  const [data, setData] = useState<ServiceStatusPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const foregroundCheckedAt = useRef(0);

  const check = useCallback(async () => {
    if (!isOnline) {
      setLoading(false);
      setError(false);
      return;
    }
    setLoading(true);
    setError(false);
    try {
      const response = await fetchWithTimeout("/api/status", {}, 5000);
      const payload = await response.json().catch(() => null) as ServiceStatusPayload | null;
      if (!payload) throw new Error("invalid status response");
      setData(payload);
      setCheckedAt(readHealthCheckedAt(response));
    } catch {
      setError(true);
      setData(null);
      setCheckedAt(new Date().toISOString());
    } finally {
      setLoading(false);
    }
  }, [isOnline]);

  useEffect(() => {
    foregroundCheckedAt.current = Date.now();
    void check();
  }, [check]);

  useEffect(() => {
    const onForeground = () => {
      if (document.visibilityState !== "visible" || !isOnline) return;
      if (!shouldRefreshAfterForeground(foregroundCheckedAt.current)) return;
      foregroundCheckedAt.current = Date.now();
      void check();
    };
    window.addEventListener("focus", onForeground);
    document.addEventListener("visibilitychange", onForeground);
    return () => {
      window.removeEventListener("focus", onForeground);
      document.removeEventListener("visibilitychange", onForeground);
    };
  }, [check, isOnline]);

  const services = [
    { key: "supabase" as ServiceKey, label: "Supabase", icon: Database },
    { key: "auth" as ServiceKey, label: "Autenticación", icon: KeyRound },
    { key: "schema" as ServiceKey, label: "Esquema de datos", icon: ShieldCheck },
    { key: "chatRetries" as ServiceKey, label: "Reintentos de Chat", icon: ShieldCheck },
    { key: "groq" as ServiceKey, label: "IA (Groq)", icon: Sparkles },
    { key: "tasks" as ServiceKey, label: "Agenda", icon: ClipboardCheck },
  ];
  const probes = services.map((service) => ({ ...service, probe: loading ? "checking" as const : error ? "unavailable" as const : serviceProbe(data, service.key, isOnline) }));

  return (
    <section className="max-w-2xl rounded-xl border border-border bg-card p-6" aria-labelledby="service-health-title">
      <div className="mb-5 flex items-start gap-3">
        <span className="rounded-lg bg-primary/10 p-2"><Database className="h-5 w-5 text-primary" /></span>
        <div className="min-w-0 flex-1">
          <h2 id="service-health-title" className="font-medium">Salud de los servicios</h2>
          <p className="text-sm text-muted-foreground">Diagnóstico rápido para entender si una falla viene de la conexión, Supabase o una migración pendiente.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void check()} disabled={loading || !isOnline}>
          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />Revisar
        </Button>
      </div>

      <div className="divide-y divide-border rounded-lg border border-border">
        {probes.map(({ key, label, icon: Icon, probe }) => (
          <div key={key} className="flex items-start gap-3 p-3.5">
            <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${probeTone(probe)}`} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{label}</span>
                <span className={`text-xs font-medium ${probeTone(probe)}`}>{serviceProbeLabel(probe, key)}</span>
              </div>
              {serviceProbeDetail(probe, key) && <p className="mt-1 text-xs text-muted-foreground">{serviceProbeDetail(probe, key)}</p>}
              {key === "schema" && probe === "missing" && data?.features?.schema?.missingMigrations && data.features.schema.missingMigrations.length > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">Pendientes: {data.features.schema.missingMigrations.join(", ")}</p>
              )}
            </div>
            {probe === "healthy" ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" /> : probe === "offline" ? <WifiOff className="h-4 w-4 shrink-0 text-amber-500" /> : <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />}
          </div>
        ))}
      </div>

      <p className="mt-3 text-xs text-muted-foreground" aria-live="polite">
        {checkedAt && !loading ? `Última comprobación: ${new Date(checkedAt).toLocaleString("es-UY")}` : !isOnline ? "Volvé a conectarte para comprobar los servicios." : "Comprobando servicios…"}
      </p>
    </section>
  );
}
