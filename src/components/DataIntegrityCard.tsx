"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  const { isOnline, offlineMode } = useFarm();
  const unavailable = offlineMode || !isOnline;
  const [data, setData] = useState<IntegrityPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const requestId = useRef(0);
  const requestRef = useRef<AbortController | null>(null);

  const check = useCallback(async () => {
    const currentRequest = ++requestId.current;
    requestRef.current?.abort();
    if (unavailable) {
      setData(null);
      setLoading(false);
      setError(false);
      return;
    }
    setLoading(true);
    setError(false);
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      const response = await fetchWithTimeout("/api/integrity", { cache: "no-store", signal: controller.signal }, 9000);
      const payload = await response.json().catch(() => null) as IntegrityPayload | null;
      if (!response.ok || !payload) throw new Error("integrity request failed");
      if (currentRequest !== requestId.current || controller.signal.aborted) return;
      setData(payload);
    } catch {
      if (controller.signal.aborted || currentRequest !== requestId.current) return;
      setData(null);
      setError(true);
    } finally {
      if (currentRequest === requestId.current) {
        setLoading(false);
        if (requestRef.current === controller) requestRef.current = null;
      }
    }
  }, [unavailable]);

  useEffect(() => {
    void check();
    return () => {
      requestId.current += 1;
      requestRef.current?.abort();
    };
  }, [check]);

  useEffect(() => subscribeToAppEvent(DATA_CHANGED_EVENT, () => { void check(); }), [check]);

  const issueCount = data?.issues?.reduce((total, issue) => total + issue.count, 0) || 0;
  const status = unavailable ? "offline" : loading ? "checking" : error ? "error" : data?.ok ? "healthy" : "issues";
  const statusLabel = status === "offline"
    ? offlineMode ? "Servidor no disponible" : "Sin conexión"
    : status === "checking"
      ? "Revisando…"
      : status === "error"
        ? "No se pudo revisar"
        : status === "healthy" ? "Sin inconsistencias detectadas" : `${issueCount} posible${issueCount === 1 ? "" : "s"} inconsistencia${issueCount === 1 ? "" : "s"}`;

  return (
    <section aria-labelledby="data-integrity-title">
      <div className="mb-3 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 id="data-integrity-title" className="text-base font-semibold">Integridad de datos</h2>
          <p className="text-sm text-muted-foreground">Comprueba vínculos de inventario y posibles caravanas repetidas.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void check()} disabled={loading || unavailable}>
          <RefreshCw className={loading ? "animate-spin" : undefined} aria-hidden="true" />Revisar
        </Button>
      </div>

      <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex items-start gap-3 px-4 py-3" role="status" aria-live="polite">
          {status === "healthy"
            ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ok" aria-hidden="true" />
            : status === "offline"
              ? <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
              : status === "checking"
                ? <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />}
          <div className="min-w-0 flex-1">
            <p className={`text-sm font-medium ${status === "healthy" ? "text-ok" : status === "checking" ? "text-muted-foreground" : "text-warn"}`}>{statusLabel}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {status === "offline" ? offlineMode ? "El diagnóstico estará disponible cuando el servidor vuelva a responder." : "Volvé a conectarte para revisar los vínculos." : error ? "Reintentá cuando Supabase vuelva a responder." : data?.sampledRows?.maxRows && (data.sampledRows.purchaseMovements === data.sampledRows.maxRows || data.sampledRows.cattleWithEarTags === data.sampledRows.maxRows) ? "La revisión alcanzó el límite de registros recientes." : "La revisión es de solo lectura y no modifica tus datos."}
            </p>
          </div>
        </div>

        {status === "issues" && data?.issues && data.issues.map((issue) => (
          <div key={issue.code} className="px-4 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-medium text-warn">{issueLabel(issue.code)}</span>
              <span className="figure text-lg font-semibold text-warn">{issue.count}</span>
            </div>
            {issue.tags && issue.tags.length > 0 && <p className="mt-0.5 text-xs text-muted-foreground">{issue.tags.join(" · ")}</p>}
            {issueHint(issue.code) && <p className="mt-0.5 text-xs text-muted-foreground">{issueHint(issue.code)}</p>}
            {issue.examples && issue.examples.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {issue.examples.map((id) => (
                  <Button key={id} variant="outline" size="xs" asChild>
                    <Link href={issueHref(issue.code, id)}>{issueLinkLabel(issue.code)}</Link>
                  </Button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
