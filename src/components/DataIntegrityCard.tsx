"use client";

import { useCallback, useEffect, useState } from "react";
import { useFarm } from "@/contexts/FarmContext";
import { fetchWithTimeout } from "@/lib/fetch";
import { DATA_CHANGED_EVENT, subscribeToAppEvent } from "@/lib/mutate";
import { AlertTriangle, CheckCircle2, RefreshCw, ShieldCheck, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";

interface IntegrityPayload {
  ok?: boolean;
  checkedAt?: string;
  sampledRows?: { purchaseMovements?: number; linkedFinancialTransactions?: number; cattleWithEarTags?: number; maxRows?: number };
  issues?: Array<{ code: string; count: number; examples?: string[]; tags?: string[] }>;
}

function issueLabel(code: string): string {
  if (code === "purchase_without_financial") return "Compra sin asiento financiero";
  if (code === "orphaned_financial_link") return "Asiento con movimiento no disponible";
  if (code === "duplicate_financial_link") return "Movimiento con asientos duplicados";
  if (code === "duplicate_cattle_ear_tag") return "Caravana repetida en la hacienda";
  return "Inconsistencia detectada";
}

function issueHref(code: string, id: string): string {
  return code === "purchase_without_financial" || code === "duplicate_financial_link"
    ? `/gestion/inventario?movementId=${encodeURIComponent(id)}`
    : code === "duplicate_cattle_ear_tag"
      ? `/produccion/hacienda?cattleId=${encodeURIComponent(id)}`
      : `/gestion/finanzas?transactionId=${encodeURIComponent(id)}`;
}

function issueLinkLabel(code: string): string {
  if (code === "duplicate_cattle_ear_tag") return "Abrir hacienda";
  return code === "purchase_without_financial" || code === "duplicate_financial_link" ? "Abrir movimiento" : "Abrir asiento";
}

function issueHint(code: string): string | null {
  if (code === "duplicate_cattle_ear_tag") return "Editá o eliminá uno de los registros antes de aplicar la migración de caravanas.";
  return null;
}

export function DataIntegrityCard() {
  const { isOnline } = useFarm();
  const [data, setData] = useState<IntegrityPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const check = useCallback(async () => {
    if (!isOnline) {
      setLoading(false);
      setError(false);
      return;
    }
    setLoading(true);
    setError(false);
    try {
      const response = await fetchWithTimeout("/api/integrity", {}, 9000);
      const payload = await response.json().catch(() => null) as IntegrityPayload | null;
      if (!response.ok || !payload) throw new Error("integrity request failed");
      setData(payload);
    } catch {
      setData(null);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [isOnline]);

  useEffect(() => { void check(); }, [check]);

  useEffect(() => subscribeToAppEvent(DATA_CHANGED_EVENT, () => { void check(); }), [check]);

  const issueCount = data?.issues?.reduce((total, issue) => total + issue.count, 0) || 0;
  const status = !isOnline ? "offline" : loading ? "checking" : error ? "error" : data?.ok ? "healthy" : "issues";
  const statusLabel = status === "offline"
    ? "Sin conexión"
    : status === "checking"
      ? "Revisando…"
      : status === "error"
        ? "No se pudo revisar"
        : status === "healthy" ? "Sin inconsistencias detectadas" : `${issueCount} posible${issueCount === 1 ? "" : "s"} inconsistencia${issueCount === 1 ? "" : "s"}`;

  return (
    <section className="max-w-2xl rounded-xl border border-border bg-card p-6" aria-labelledby="data-integrity-title">
      <div className="mb-4 flex items-start gap-3">
        <span className="rounded-lg bg-primary/10 p-2"><ShieldCheck className="h-5 w-5 text-primary" /></span>
        <div className="min-w-0 flex-1">
          <h2 id="data-integrity-title" className="font-medium">Integridad de datos</h2>
          <p className="text-sm text-muted-foreground">Comprueba vínculos de inventario y posibles caravanas repetidas.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void check()} disabled={loading || !isOnline}>
          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />Revisar
        </Button>
      </div>

      <div className="flex items-start gap-3 rounded-lg border border-border p-3.5" role="status" aria-live="polite">
        {status === "healthy" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /> : status === "offline" ? <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />}
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-medium ${status === "healthy" ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>{statusLabel}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {status === "offline" ? "Volvé a conectarte para revisar los vínculos." : error ? "Reintentá cuando Supabase vuelva a responder." : data?.sampledRows?.maxRows && (data.sampledRows.purchaseMovements === data.sampledRows.maxRows || data.sampledRows.cattleWithEarTags === data.sampledRows.maxRows) ? "La revisión alcanzó el límite de registros recientes." : "La revisión es de solo lectura y no modifica tus datos."}
          </p>
        </div>
      </div>

      {status === "issues" && data?.issues && (
        <div className="mt-3 space-y-2">
          {data.issues.map((issue) => (
            <div key={issue.code} className="rounded-lg border border-amber-300/60 bg-amber-50/60 p-3 dark:border-amber-900/70 dark:bg-amber-950/20">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="font-medium text-amber-900 dark:text-amber-100">{issueLabel(issue.code)}</span>
                <span className="text-amber-800/80 dark:text-amber-200/80">{issue.count}</span>
              </div>
              {issue.tags && issue.tags.length > 0 && <p className="mt-1 text-[11px] text-amber-800/80 dark:text-amber-200/80">{issue.tags.join(" · ")}</p>}
              {issueHint(issue.code) && <p className="mt-1 text-[11px] text-amber-800/80 dark:text-amber-200/80">{issueHint(issue.code)}</p>}
              {issue.examples && issue.examples.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {issue.examples.map((id) => (
                    <Link key={id} href={issueHref(issue.code, id)} className="rounded border border-amber-400/50 px-2 py-1 text-[11px] text-amber-900 underline-offset-2 hover:underline dark:border-amber-700 dark:text-amber-100">
                      {issueLinkLabel(issue.code)}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
