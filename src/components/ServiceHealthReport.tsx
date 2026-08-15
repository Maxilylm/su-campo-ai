"use client";

import { AlertTriangle, CheckCircle2, ClipboardCheck, Database, KeyRound, RefreshCw, ShieldCheck, Sparkles, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SchemaMigrationNotice } from "@/components/SchemaMigrationNotice";
import { serviceProbe, serviceProbeDetail, serviceProbeLabel, type ServiceKey, type ServiceProbe, type ServiceStatusPayload } from "@/lib/service-status";

interface ServiceHealthReportProps {
  data: ServiceStatusPayload | null;
  loading: boolean;
  error: boolean;
  checkedAt: string | null;
  isOnline: boolean;
  onCheck: () => void;
  compact?: boolean;
}

const SERVICES = [
  { key: "supabase" as ServiceKey, label: "Supabase", icon: Database },
  { key: "auth" as ServiceKey, label: "Autenticación", icon: KeyRound },
  { key: "schema" as ServiceKey, label: "Esquema de datos", icon: ShieldCheck },
  { key: "chatRetries" as ServiceKey, label: "Reintentos de Chat", icon: ShieldCheck },
  { key: "sampleData" as ServiceKey, label: "Datos de ejemplo", icon: Database },
  { key: "groq" as ServiceKey, label: "IA (Groq)", icon: Sparkles },
  { key: "tasks" as ServiceKey, label: "Agenda", icon: ClipboardCheck },
] as const;

function probeTone(probe: ServiceProbe): string {
  if (probe === "healthy") return "text-emerald-600 dark:text-emerald-400";
  if (probe === "checking") return "text-muted-foreground";
  return "text-amber-600 dark:text-amber-400";
}

export function ServiceHealthReport({ data, loading, error, checkedAt, isOnline, onCheck, compact = false }: ServiceHealthReportProps) {
  const probes = SERVICES.map((service) => ({
    ...service,
    probe: loading ? "checking" as const : error ? "unavailable" as const : serviceProbe(data, service.key, isOnline),
  }));
  const titleId = compact ? "service-health-compact-title" : "service-health-title";

  return (
    <section className={compact ? "rounded-lg border border-border bg-card p-4" : "max-w-2xl rounded-xl border border-border bg-card p-6"} aria-labelledby={titleId}>
      <div className={compact ? "mb-3 flex items-start gap-2" : "mb-5 flex items-start gap-3"}>
        <span className="rounded-lg bg-primary/10 p-2"><Database className="h-5 w-5 text-primary" /></span>
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="font-medium">Salud de los servicios</h2>
          <p className="text-sm text-muted-foreground">Diagnóstico rápido de conexión, Supabase y migraciones pendientes.</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onCheck} disabled={loading || !isOnline}>
          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />Revisar
        </Button>
      </div>

      {error && !loading && (
        <div role="alert" className="mb-4 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          No se pudo completar el diagnóstico. Revisá la conexión y probá nuevamente.
        </div>
      )}

      <div className="divide-y divide-border rounded-lg border border-border">
        {probes.map(({ key, label, icon: Icon, probe }) => (
          <div key={key} className={compact ? "flex items-start gap-2 p-2.5" : "flex items-start gap-3 p-3.5"}>
            <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${probeTone(probe)}`} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{label}</span>
                <span className={`text-xs font-medium ${probeTone(probe)}`}>{serviceProbeLabel(probe, key)}</span>
              </div>
              {serviceProbeDetail(probe, key) && <p className="mt-1 text-xs text-muted-foreground">{serviceProbeDetail(probe, key)}</p>}
              {key === "schema" && data?.features?.schema?.missingMigrations && data.features.schema.missingMigrations.length > 0 && <SchemaMigrationNotice migrations={data.features.schema.missingMigrations} compact />}
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
