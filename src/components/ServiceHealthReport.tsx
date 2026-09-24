"use client";

import { AlertTriangle, CheckCircle2, ClipboardCheck, Database, KeyRound, RefreshCw, ShieldCheck, Sparkles, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SchemaMigrationNotice } from "@/components/SchemaMigrationNotice";
import { schemaHasOnlyProviderWarnings, schemaProbeIssueLabel, serviceProbe, serviceProbeDetail, serviceProbeLabel, type ServiceKey, type ServiceProbe, type ServiceStatusPayload } from "@/lib/service-status";

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
  { key: "chatRetries" as ServiceKey, label: "Reintentos del chat", icon: ShieldCheck },
  { key: "sampleData" as ServiceKey, label: "Datos de ejemplo", icon: Database },
  { key: "groq" as ServiceKey, label: "IA (Groq)", icon: Sparkles },
  { key: "tasks" as ServiceKey, label: "Agenda", icon: ClipboardCheck },
] as const;

function probeTone(probe: ServiceProbe): string {
  if (probe === "healthy") return "text-ok";
  if (probe === "checking") return "text-muted-foreground";
  return "text-warn";
}

export function ServiceHealthReport({ data, loading, error, checkedAt, isOnline, onCheck, compact = false }: ServiceHealthReportProps) {
  const probes = SERVICES.map((service) => ({
    ...service,
    probe: loading ? "checking" as const : error ? "unavailable" as const : serviceProbe(data, service.key, isOnline),
  }));
  const titleId = compact ? "service-health-compact-title" : "service-health-title";
  const schemaIssues = data?.features?.schema?.issues || [];
  const issueMigrations = Array.from(new Set(schemaIssues.map(schemaProbeIssueLabel).filter(Boolean)));
  const schemaMigrations = data?.features?.schema?.missingMigrations || [];
  const schemaProviderWarnings = schemaHasOnlyProviderWarnings(schemaIssues, schemaMigrations);
  const schemaHasBlockingAlerts = schemaMigrations.length > 0 || (schemaIssues.length > 0 && !schemaProviderWarnings);
  const schemaVerificationPending = data?.features?.schema?.reason === "timeout";

  return (
    <section className={compact ? "rounded-lg border border-border bg-card p-4" : undefined} aria-labelledby={titleId}>
      <div className="mb-3 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className={compact ? "text-sm font-semibold" : "text-base font-semibold"}>Salud de los servicios</h2>
          <p className="text-sm text-muted-foreground">Diagnóstico rápido de conexión, Supabase y migraciones pendientes.</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onCheck} disabled={loading || !isOnline}>
          <RefreshCw className={loading ? "animate-spin" : undefined} aria-hidden="true" />Revisar
        </Button>
      </div>

      {error && !loading && (
        <div role="alert" className="mb-3 rounded-lg border border-warn-line bg-warn-soft px-3 py-2 text-sm text-warn">
          No se pudo completar el diagnóstico. Revisá la conexión y probá nuevamente.
        </div>
      )}

      <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
        {probes.map(({ key, label, icon: Icon, probe }) => (
          <div key={key} className={compact ? "flex items-start gap-2 px-3 py-2.5" : "flex items-start gap-3 px-4 py-3"}>
            <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${key === "schema" && probe === "healthy" && schemaHasBlockingAlerts ? "text-warn" : probeTone(probe)}`} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{label}</span>
                <span className={`text-xs font-medium ${key === "schema" && schemaHasBlockingAlerts ? "text-warn" : probeTone(probe)}`}>
                  {key === "schema" && probe === "healthy" && schemaHasBlockingAlerts
                    ? "Disponible con alertas"
                    : key === "schema" && schemaProviderWarnings
                      ? "Disponible; verificación parcial"
                      : key === "schema" && schemaVerificationPending
                        ? "Disponible; verificación pendiente"
                      : serviceProbeLabel(probe, key)}
                </span>
              </div>
              {key === "schema" && schemaProviderWarnings
                ? <p className="mt-1 text-xs text-muted-foreground">Supabase respondió, pero algunas verificaciones del proveedor requieren revisión. No se detectaron migraciones faltantes.</p>
                : serviceProbeDetail(probe, key) && <p className="mt-1 text-xs text-muted-foreground">{serviceProbeDetail(probe, key)}</p>}
              {key === "schema" && schemaIssues.length > 0 && <SchemaMigrationNotice migrations={issueMigrations} mode="diagnostic" compact />}
              {key === "schema" && schemaMigrations.length > 0 && <SchemaMigrationNotice migrations={schemaMigrations} compact />}
            </div>
            {probe === "healthy" && !(key === "schema" && schemaHasBlockingAlerts) ? <CheckCircle2 className="h-4 w-4 shrink-0 text-ok" aria-hidden="true" /> : probe === "offline" ? <WifiOff className="h-4 w-4 shrink-0 text-warn" aria-hidden="true" /> : probe === "checking" ? null : <AlertTriangle className="h-4 w-4 shrink-0 text-warn" aria-hidden="true" />}
          </div>
        ))}
      </div>

      <p className="mt-3 text-xs text-muted-foreground" aria-live="polite">
        {checkedAt && !loading ? `Última comprobación: ${new Date(checkedAt).toLocaleString("es-UY")}` : !isOnline ? "Volvé a conectarte para comprobar los servicios." : "Comprobando servicios…"}
      </p>
    </section>
  );
}
