"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useFarm } from "@/contexts/FarmContext";
import { DATA_CHANGED_EVENT, subscribeToAppEvent } from "@/lib/mutate";
import { fetchWithTimeout } from "@/lib/fetch";
import { activityHref } from "@/lib/activity";
import { isOfflineSnapshotFresh, offlineActivitySnapshotKey, parseOfflineActivitySnapshot } from "@/lib/offline";
import { useOfflineSnapshotRefresh } from "@/lib/use-offline-snapshot-refresh";
import { useOfflineAwareNavigation } from "@/lib/use-offline-aware-navigation";
import { aiChatHandoffKey, buildOperationalChatPrompt } from "@/lib/ai-handoff";
import { Button } from "@/components/ui/button";
import { ArrowLeftRight, ArrowRight, BarChart3, ClipboardList, FileText, Heart, Mic, RefreshCw, Settings, Sparkles } from "lucide-react";

interface Activity {
  id: string;
  type: string;
  description: string;
  raw_message: string | null;
  message_type: string;
  reported_by: string | null;
  created_at: string;
  metadata: { table?: string | null; record_id?: string | null } | null;
}

const ICONS = {
  movement: ArrowLeftRight,
  count_update: BarChart3,
  health: Heart,
  note: FileText,
  setup: Settings,
  registration: ClipboardList,
} as const;

function formatActivityDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function RecentActivityPanel() {
  const { userId, offlineMode, isOnline } = useFarm();
  const navigate = useOfflineAwareNavigation();
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activitySyncedAt, setActivitySyncedAt] = useState<string | null>(null);
  const requestId = useRef(0);
  const requestRef = useRef<AbortController | null>(null);

  const loadActivities = useCallback(async () => {
    const currentRequest = ++requestId.current;
    requestRef.current?.abort();
    if (!isOnline || offlineMode) {
      let cached = null;
      try {
        cached = userId
          ? parseOfflineActivitySnapshot(window.localStorage.getItem(offlineActivitySnapshotKey(userId)))
          : null;
      } catch {
        cached = null;
      }
      if (cached && isOfflineSnapshotFresh(cached.savedAt)) {
        setActivities(cached.activities.slice(0, 5) as Activity[]);
        setActivitySyncedAt(cached.savedAt);
      } else {
        setActivities([]);
        setActivitySyncedAt(null);
      }
      setLoadError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      const res = await fetchWithTimeout("/api/activities?limit=5", { signal: controller.signal }, 8000);
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof payload.error === "string" ? payload.error : "No se pudo cargar la actividad reciente.");
      const data = payload;
      if (controller.signal.aborted || currentRequest !== requestId.current) return;
      const nextActivities = Array.isArray(data) ? data : [];
      setActivities(nextActivities);
      const savedAt = new Date().toISOString();
      setActivitySyncedAt(savedAt);
      if (userId) {
        try {
          window.localStorage.setItem(offlineActivitySnapshotKey(userId), JSON.stringify({ activities: nextActivities, savedAt }));
        } catch {
          // Storage is optional; the online panel remains usable without it.
        }
      }
      setLoadError(null);
    } catch (reason) {
      if (controller.signal.aborted || currentRequest !== requestId.current) return;
      if (currentRequest === requestId.current) {
        setLoadError(reason instanceof Error ? reason.message : "No se pudo cargar la actividad reciente.");
      }
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
      if (requestRef.current === controller) requestRef.current = null;
    }
  }, [isOnline, offlineMode, userId]);

  useEffect(() => {
    void loadActivities();
    return () => {
      requestId.current += 1;
      requestRef.current?.abort();
    };
  }, [loadActivities]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onDataChanged = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { void loadActivities(); }, 300);
    };
    const unsubscribe = subscribeToAppEvent(DATA_CHANGED_EVENT, onDataChanged);
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [loadActivities]);

  useOfflineSnapshotRefresh(loadActivities, userId, offlineMode || !isOnline);

  const readOnly = offlineMode || !isOnline;
  const actionReadOnly = readOnly;

  function askCampoAI() {
    if (!userId || actionReadOnly || activities.length === 0) return;
    try {
      window.sessionStorage.setItem(aiChatHandoffKey(userId), buildOperationalChatPrompt(
        activities.map((activity) => ({
          label: activity.description,
          detail: activity.raw_message ? `Mensaje original: ${activity.raw_message}` : "",
        })),
        "la actividad reciente",
      ));
    } catch {
      // Chat remains available even when session storage is unavailable.
    }
    navigate("/chat?from=activity");
  }
  if ((readOnly && activities.length === 0) || (!readOnly && loading && activities.length === 0)) {
    if (readOnly) return null;
    return <div className="mb-8 rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">Cargando actividad reciente…</div>;
  }

  if (loadError && activities.length === 0) {
    return (
      <div className="mb-8 flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
        <span>{loadError}</span>
        <button type="button" onClick={() => void loadActivities()} className="inline-flex items-center gap-1.5 hover:text-foreground">
          <RefreshCw className="h-3.5 w-3.5" /> Reintentar
        </button>
      </div>
    );
  }

  if (activities.length === 0) return null;

  return (
    <section className="mb-8 rounded-xl border border-border bg-card p-5" aria-labelledby="recent-activity-title">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="recent-activity-title" className="text-lg font-medium">Actividad reciente</h2>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={askCampoAI} disabled={actionReadOnly || !userId} title={readOnly ? "Necesitás conexión para consultar a CampoAI" : undefined}>
            <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Preguntar
          </Button>
          <Link href="/gestion/registro" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            Ver registro <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
      {readOnly && activitySyncedAt && (
        <p role="status" className="mb-3 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground">
          Mostrando actividad sincronizada el {new Date(activitySyncedAt).toLocaleString("es-UY")}. Modo lectura.
        </p>
      )}
      <div className="divide-y divide-border">
        {activities.map((activity) => {
          const Icon = ICONS[activity.type as keyof typeof ICONS] || ClipboardList;
          return (
            <div key={activity.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
              <span className="mt-0.5 rounded-lg bg-muted p-2"><Icon className="h-4 w-4 text-muted-foreground" /></span>
              <div className="min-w-0 flex-1">
                <p className="text-sm leading-relaxed">{activity.description}</p>
                {activity.reported_by && <p className="mt-1 text-xs text-muted-foreground">Por {activity.reported_by}</p>}
                {activity.raw_message && (
                  <p className="mt-1 truncate text-xs italic text-muted-foreground">
                    {activity.message_type === "audio" && <Mic className="mr-1 inline h-3 w-3" />}&quot;{activity.raw_message}&quot;
                  </p>
                )}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <time dateTime={activity.created_at} className="text-xs tabular-nums text-muted-foreground">{formatActivityDate(activity.created_at)}</time>
                {activityHref(activity) && <button type="button" onClick={() => navigate(activityHref(activity) || "/")} className="text-xs font-medium text-primary hover:underline">Abrir</button>}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
