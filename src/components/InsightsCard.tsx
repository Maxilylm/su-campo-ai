"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Sparkles, RefreshCw } from "lucide-react";
import { fetchWithTimeout } from "@/lib/fetch";
import { useFarm } from "@/contexts/FarmContext";
import { DATA_CHANGED_EVENT, INSIGHTS_CHANGED_EVENT, notifyInsightsChanged, subscribeToAppEvent } from "@/lib/mutate";
import { isOfflineSnapshotFresh, offlineInsightSnapshotKey, parseOfflineInsightSnapshot } from "@/lib/offline";
import { useOfflineSnapshotRefresh } from "@/lib/use-offline-snapshot-refresh";
import { aiInsightsHandoffKey, buildInsightsChatPrompt } from "@/lib/ai-handoff";
import { useOfflineAwareNavigation } from "@/lib/use-offline-aware-navigation";

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
  const { offlineMode, isOnline, userId, readOnly: permissionReadOnly } = useFarm();
  const navigate = useOfflineAwareNavigation();
  const offlineReadOnly = offlineMode || !isOnline;
  const actionReadOnly = offlineReadOnly || permissionReadOnly;
  const [summary, setSummary] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cacheVersion, setCacheVersion] = useState(0);
  const [stale, setStale] = useState(false);
  const loadControllerRef = useRef<AbortController | null>(null);
  const refreshControllerRef = useRef<AbortController | null>(null);

  useEffect(() => subscribeToAppEvent(INSIGHTS_CHANGED_EVENT, () => setCacheVersion((version) => version + 1)), []);
  useEffect(() => subscribeToAppEvent(DATA_CHANGED_EVENT, () => setStale(true)), []);
  const refreshOfflineSnapshot = useCallback(() => setCacheVersion((version) => version + 1), []);
  useOfflineSnapshotRefresh(refreshOfflineSnapshot, userId, offlineReadOnly);

  useEffect(() => () => {
    loadControllerRef.current?.abort();
    refreshControllerRef.current?.abort();
  }, []);

  useEffect(() => {
    let active = true;
    if (offlineReadOnly) {
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
    loadControllerRef.current?.abort();
    const controller = new AbortController();
    loadControllerRef.current = controller;
    fetchWithTimeout("/api/insights", { signal: controller.signal }, 8000)
      .then(async (r) => {
        const payload = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(typeof payload.error === "string" ? payload.error : "No se pudo cargar el resumen.");
        return payload;
      })
      .then((d: InsightResp) => {
        if (active && !controller.signal.aborted) {
          setSummary(d.summary ?? null);
          setGeneratedAt(d.generated_at ?? null);
          const nextSavedAt = new Date().toISOString();
          setSavedAt(nextSavedAt);
          persistInsightSnapshot(userId, d, nextSavedAt);
          setStale(false);
          setError(null);
        }
      })
      .catch((reason) => {
        if (active && !controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : "No se pudo cargar el resumen.");
        }
      })
      .finally(() => {
        if (active && !controller.signal.aborted) setLoading(false);
        if (loadControllerRef.current === controller) loadControllerRef.current = null;
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [cacheVersion, offlineReadOnly, userId]);

  async function refresh() {
    if (permissionReadOnly) {
      setError("Solo el propietario o los editores pueden generar el resumen.");
      return;
    }
    if (offlineReadOnly) {
      setError("El resumen IA requiere conexión.");
      return;
    }
    loadControllerRef.current?.abort();
    refreshControllerRef.current?.abort();
    const controller = new AbortController();
    refreshControllerRef.current = controller;
    setRefreshing(true);
    setError(null);
    try {
      const r = await fetchWithTimeout("/api/insights", { method: "POST", signal: controller.signal }, 27_000);
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
    } catch (reason) {
      if (!controller.signal.aborted) {
        setError(reason instanceof Error ? reason.message : "No se pudo generar el resumen.");
      }
    } finally {
      if (!controller.signal.aborted) setRefreshing(false);
      if (refreshControllerRef.current === controller) refreshControllerRef.current = null;
    }
  }

  function askCampoAI() {
    if (!userId || !summary?.trim()) return;
    try {
      window.sessionStorage.setItem(aiInsightsHandoffKey(userId), buildInsightsChatPrompt(summary));
    } catch {
      // The chat still opens if session storage is unavailable; no data is lost.
    }
    navigate("/chat?from=insights");
  }

  if (loading) {
    return <div className="mb-8 rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">Generando resumen…</div>;
  }
  if (!summary && error) {
    return (
      <div className="mb-8 rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground flex items-center justify-between gap-3">
        <span>{error}</span>
        <button type="button" onClick={refresh} disabled={refreshing || actionReadOnly} className="inline-flex items-center gap-1.5 hover:text-foreground disabled:opacity-50">
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
            <p className="mt-1 text-sm text-muted-foreground">Analizá alertas, producción y finanzas cuando quieras.{permissionReadOnly && " Solo el propietario o los editores pueden generarlo."}</p>
          </div>
          <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing || actionReadOnly}>
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
        <div className="flex items-center gap-3">
          <button type="button" onClick={askCampoAI} disabled={!userId} className="text-xs text-emerald-700 dark:text-emerald-400 hover:underline disabled:opacity-50">
            Preguntarle a CampoAI
          </button>
          <button type="button"
            onClick={refresh}
            disabled={refreshing || actionReadOnly}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} /> Actualizar
          </button>
        </div>
      </div>
      <p className="text-sm leading-relaxed whitespace-pre-line">{summary}</p>
      {stale && (
        <p role="status" className="mt-3 text-xs text-amber-700 dark:text-amber-400">
          Los datos del campo cambiaron desde este resumen. {permissionReadOnly ? "Solo el propietario o los editores pueden generar una nueva versión." : "Actualizalo para reflejar la información más reciente."}
        </p>
      )}
      {savedAt && offlineReadOnly && (
        <p role="status" className="mt-3 text-xs text-amber-700 dark:text-amber-400">
          Mostrando una copia guardada el {new Date(savedAt).toLocaleString("es-UY", { dateStyle: "short", timeStyle: "short" })}. Podés actualizarla al recuperar la conexión.
        </p>
      )}
      {when && <p className="mt-3 text-xs text-muted-foreground">Generado {when}</p>}
    </div>
  );
}
