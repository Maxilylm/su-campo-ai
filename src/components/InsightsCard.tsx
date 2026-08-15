"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Sparkles, RefreshCw } from "lucide-react";
import { fetchWithTimeout } from "@/lib/fetch";
import { useFarm } from "@/contexts/FarmContext";
import { DATA_CHANGED_EVENT, INSIGHTS_CHANGED_EVENT, notifyInsightsChanged, subscribeToAppEvent } from "@/lib/mutate";
import { isOfflineSnapshotFresh, offlineInsightSnapshotKey, parseOfflineInsightSnapshot } from "@/lib/offline";
import { useOfflineSnapshotRefresh } from "@/lib/use-offline-snapshot-refresh";

interface InsightResp { summary?: string | null; generated_at?: string | null; error?: string }

function persistInsightSnapshot(userId: string | null, insight: InsightResp, savedAt: string): void {
  if (!userId || !insight.summary?.trim()) return;
  try {
    window.localStorage.setItem(offlineInsightSnapshotKey(userId), JSON.stringify({
      summary: insight.summary,
      generatedAt: insight.generated_at ?? null,
      savedAt,
    }));
  } catch {
    // Private browsing and storage limits must not block the online summary.
  }
}

export function InsightsCard() {
  const { offlineMode, isOnline, userId } = useFarm();
  const [summary, setSummary] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cacheVersion, setCacheVersion] = useState(0);
  const [stale, setStale] = useState(false);

  useEffect(() => subscribeToAppEvent(INSIGHTS_CHANGED_EVENT, () => setCacheVersion((version) => version + 1)), []);
  useEffect(() => subscribeToAppEvent(DATA_CHANGED_EVENT, () => setStale(true)), []);
  const refreshOfflineSnapshot = useCallback(() => setCacheVersion((version) => version + 1), []);
  useOfflineSnapshotRefresh(refreshOfflineSnapshot, userId, offlineMode || !isOnline);

  useEffect(() => {
    let active = true;
    if (offlineMode || !isOnline) {
      let cached = null;
      try {
        cached = userId
          ? parseOfflineInsightSnapshot(window.localStorage.getItem(offlineInsightSnapshotKey(userId)))
          : null;
      } catch {
        cached = null;
      }
      if (cached && isOfflineSnapshotFresh(cached.savedAt)) {
        setSummary(cached.summary);
        setGeneratedAt(cached.generatedAt);
        setSavedAt(cached.savedAt);
        setError(null);
      } else {
        setSummary(null);
        setGeneratedAt(null);
        setSavedAt(null);
        setError("El resumen IA requiere conexión y todavía no hay una copia local disponible.");
      }
      setLoading(false);
      return () => { active = false; };
    }
    setLoading(true);
    setError(null);
    fetchWithTimeout("/api/insights", {}, 8000)
      .then(async (r) => {
        const payload = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(typeof payload.error === "string" ? payload.error : "No se pudo cargar el resumen.");
        return payload;
      })
      .then((d: InsightResp) => {
        if (active) {
          setSummary(d.summary ?? null);
          setGeneratedAt(d.generated_at ?? null);
          const nextSavedAt = new Date().toISOString();
          setSavedAt(nextSavedAt);
          persistInsightSnapshot(userId, d, nextSavedAt);
          setStale(false);
          setError(null);
        }
      })
      .catch((reason) => active && setError(reason instanceof Error ? reason.message : "No se pudo cargar el resumen."))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [cacheVersion, offlineMode, isOnline, userId]);

  async function refresh() {
    if (offlineMode || !isOnline) {
      setError("El resumen IA requiere conexión.");
      return;
    }
    setRefreshing(true);
    setError(null);
    try {
      const r = await fetchWithTimeout("/api/insights", { method: "POST" }, 20_000);
      const payload = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof payload.error === "string" ? payload.error : "No se pudo generar el resumen.");
      const d = payload as InsightResp;
      setSummary(d.summary ?? null);
      setGeneratedAt(d.generated_at ?? null);
      const nextSavedAt = new Date().toISOString();
      setSavedAt(nextSavedAt);
      persistInsightSnapshot(userId, d, nextSavedAt);
      setStale(false);
      setError(null);
      notifyInsightsChanged();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo generar el resumen."); }
    setRefreshing(false);
  }

  if (loading) {
    return <div className="mb-8 rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">Generando resumen…</div>;
  }
  if (!summary && error) {
    return (
      <div className="mb-8 rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground flex items-center justify-between gap-3">
        <span>{error}</span>
        <button type="button" onClick={refresh} disabled={refreshing || offlineMode || !isOnline} className="inline-flex items-center gap-1.5 hover:text-foreground disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} /> Reintentar
        </button>
      </div>
    );
  }
  if (!summary) {
    return (
      <div className="mb-8 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-400">
              <Sparkles className="h-4 w-4" /> Resumen del campo
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">Analizá alertas, producción y finanzas cuando quieras.</p>
          </div>
          <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing || offlineMode || !isOnline}>
            <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            {refreshing ? "Generando…" : "Generar resumen"}
          </Button>
        </div>
        {error && <p className="mt-3 text-xs text-destructive">{error} Intentá nuevamente.</p>}
      </div>
    );
  }

  const when = generatedAt
    ? new Date(generatedAt).toLocaleDateString("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : "";

  return (
    <div className="mb-8 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-5">
      <div className="flex items-center justify-between gap-3 mb-2">
        <h2 className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-400">
          <Sparkles className="h-4 w-4" /> Resumen del campo
        </h2>
        <button type="button"
          onClick={refresh}
          disabled={refreshing || offlineMode || !isOnline}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} /> Actualizar
        </button>
      </div>
      <p className="text-sm leading-relaxed whitespace-pre-line">{summary}</p>
      {stale && (
        <p role="status" className="mt-3 text-xs text-amber-700 dark:text-amber-400">
          Los datos del campo cambiaron desde este resumen. Actualizalo para reflejar la información más reciente.
        </p>
      )}
      {savedAt && (offlineMode || !isOnline) && (
        <p role="status" className="mt-3 text-xs text-amber-700 dark:text-amber-400">
          Mostrando una copia guardada el {new Date(savedAt).toLocaleString("es-UY", { dateStyle: "short", timeStyle: "short" })}. Podés actualizarla al recuperar la conexión.
        </p>
      )}
      {when && <p className="mt-3 text-xs text-muted-foreground">Generado {when}</p>}
    </div>
  );
}
