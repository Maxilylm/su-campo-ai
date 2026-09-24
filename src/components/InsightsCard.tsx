"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ClipboardCheck, Sparkles, RefreshCw } from "lucide-react";
import { fetchWithTimeout } from "@/lib/fetch";
import { useFarm } from "@/contexts/FarmContext";
import { DATA_CHANGED_EVENT, INSIGHTS_CHANGED_EVENT, notifyInsightsChanged, subscribeToAppEvent } from "@/lib/mutate";
import { isOfflineSnapshotFresh, offlineInsightSnapshotKey, parseOfflineInsightSnapshot } from "@/lib/offline";
import { useOfflineSnapshotRefresh } from "@/lib/use-offline-snapshot-refresh";
import { aiInsightsHandoffKey, buildInsightsChatPrompt } from "@/lib/ai-handoff";
import { useOfflineAwareNavigation } from "@/lib/use-offline-aware-navigation";
import { AI_CONTEXT_UNAVAILABLE_CODE } from "@/lib/ai-errors";

interface InsightResp { summary?: string | null; generated_at?: string | null; error?: string; code?: string }

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
  const navigate = useOfflineAwareNavigation();
  const offlineReadOnly = offlineMode || !isOnline;
  // Generating the derived summary is an AI read operation; only offline mode
  // blocks it. Operational changes proposed from Chat remain server-guarded.
  const actionReadOnly = offlineReadOnly;
  const [summary, setSummary] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cacheVersion, setCacheVersion] = useState(0);
  const [stale, setStale] = useState(false);
  const [diagnosticAvailable, setDiagnosticAvailable] = useState(false);
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
      setDiagnosticAvailable(false);
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
    setDiagnosticAvailable(false);
    loadControllerRef.current?.abort();
    const controller = new AbortController();
    loadControllerRef.current = controller;
    fetchWithTimeout("/api/insights", { signal: controller.signal }, 8000)
      .then(async (r) => {
        const payload = await r.json().catch(() => ({}));
        if (!r.ok) {
          const error = new Error(typeof payload.error === "string" ? payload.error : "No se pudo cargar el resumen.");
          (error as Error & { code?: unknown }).code = payload.code;
          throw error;
        }
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
          setDiagnosticAvailable(reason instanceof Error && (reason as Error & { code?: unknown }).code === AI_CONTEXT_UNAVAILABLE_CODE);
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
    setDiagnosticAvailable(false);
    try {
      const r = await fetchWithTimeout("/api/insights", { method: "POST", signal: controller.signal }, 27_000);
      const payload = await r.json().catch(() => ({}));
      if (!r.ok) {
        const error = new Error(typeof payload.error === "string" ? payload.error : "No se pudo generar el resumen.");
        (error as Error & { code?: unknown }).code = payload.code;
        throw error;
      }
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
        setDiagnosticAvailable(reason instanceof Error && (reason as Error & { code?: unknown }).code === AI_CONTEXT_UNAVAILABLE_CODE);
      }
    } finally {
      if (!controller.signal.aborted) setRefreshing(false);
      if (refreshControllerRef.current === controller) refreshControllerRef.current = null;
    }
  }

  function handoffToCampoAI(focus: "priorities" | "tasks") {
    if (!userId || offlineReadOnly || !summary?.trim()) return;
    try {
      window.sessionStorage.setItem(aiInsightsHandoffKey(userId), buildInsightsChatPrompt(summary, focus));
    } catch {
      // The chat still opens if session storage is unavailable; no data is lost.
    }
    navigate("/chat?from=insights");
  }

  if (loading) {
    return <div className="rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground">Generando resumen…</div>;
  }
  if (!summary && error) {
    return (
      <div className="rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground flex flex-wrap items-center justify-between gap-3">
        <span className="min-w-0 flex-1">{error}</span>
        <div className="flex shrink-0 items-center gap-3">
          {diagnosticAvailable && <Button variant="link" size="sm" onClick={() => navigate("/gestion/campo")} className="h-auto px-0">Ver diagnóstico</Button>}
          <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing || actionReadOnly}>
            <RefreshCw className={refreshing ? "animate-spin" : ""} aria-hidden="true" /> Reintentar
          </Button>
        </div>
      </div>
    );
  }
  if (!summary) {
    return (
      <div className="rounded-lg border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" /> Resumen de CampoAI
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">Analizá alertas, producción y finanzas cuando quieras.</p>
          </div>
          <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing || actionReadOnly}>
            <Sparkles aria-hidden="true" />
            {refreshing ? "Generando…" : "Generar resumen"}
          </Button>
        </div>
        {error && <p className="mt-3 text-xs text-bad">{error} Intentá nuevamente.</p>}
      </div>
    );
  }

  const when = generatedAt
    ? new Date(generatedAt).toLocaleDateString("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : "";

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" /> Resumen de CampoAI
        </h2>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <button type="button" onClick={() => handoffToCampoAI("priorities")} disabled={!userId || offlineReadOnly} title={offlineReadOnly ? "Necesitás conexión para consultar a CampoAI" : undefined} className="text-xs font-medium text-primary hover:underline disabled:opacity-50">
            Preguntarle a CampoAI
          </button>
          <button type="button" onClick={() => handoffToCampoAI("tasks")} disabled={!userId || offlineReadOnly} title={offlineReadOnly ? "Necesitás conexión para consultar a CampoAI" : undefined} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline disabled:opacity-50">
            <ClipboardCheck className="h-3.5 w-3.5" aria-hidden="true" /> Planificar tareas
          </button>
          <button type="button"
            onClick={refresh}
            disabled={refreshing || actionReadOnly}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} aria-hidden="true" /> Actualizar
          </button>
        </div>
      </div>
      <p className="max-w-[72ch] text-sm leading-relaxed whitespace-pre-line">{summary}</p>
      {stale && (
        <p role="status" className="mt-3 text-xs text-warn">
          Los datos del campo cambiaron desde este resumen. Actualizalo para reflejar la información más reciente.
        </p>
      )}
      {savedAt && offlineReadOnly && (
        <p role="status" className="mt-3 text-xs text-warn">
          Mostrando una copia guardada el {new Date(savedAt).toLocaleString("es-UY", { dateStyle: "short", timeStyle: "short" })}. Podés actualizarla al recuperar la conexión.
        </p>
      )}
      {error && <p role="alert" className="mt-3 text-xs text-bad">No se pudo actualizar: {error} Se muestra el resumen anterior.</p>}
      {when && <p className="mt-3 text-xs text-muted-foreground">Generado {when}</p>}
    </div>
  );
}
