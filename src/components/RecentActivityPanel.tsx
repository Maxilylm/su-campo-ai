"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useFarm } from "@/contexts/FarmContext";
import { DATA_CHANGED_EVENT, subscribeToAppEvent } from "@/lib/mutate";
import { fetchWithTimeout } from "@/lib/fetch";
import { activityHref, formatActivityDate, presentActivities } from "@/lib/activity";
import { isOfflineSnapshotFresh, offlineActivitySnapshotKey, parseOfflineActivitySnapshot } from "@/lib/offline";
import { useOfflineSnapshotRefresh } from "@/lib/use-offline-snapshot-refresh";
import { useOfflineAwareNavigation } from "@/lib/use-offline-aware-navigation";
import { aiChatHandoffKey, buildOperationalChatPrompt } from "@/lib/ai-handoff";
import { Button } from "@/components/ui/button";
import { ArrowLeftRight, ArrowRight, BarChart3, ChevronRight, ClipboardList, FileText, Heart, Mic, RefreshCw, Settings, Sparkles } from "lucide-react";

interface Activity {
  id: string;
  type: string;
  description: string;
  raw_message: string | null;
  message_type: string;
  reported_by: string | null;
  created_at: string;
  metadata: { table?: string | null; record_id?: string | null; action?: string | null } | null;
}

const ICONS = {
  movement: ArrowLeftRight,
  count_update: BarChart3,
  health: Heart,
  note: FileText,
  setup: Settings,
  registration: ClipboardList,
} as const;

// Fetch more than are shown: audit rows that merely repeat a readable entry
// are folded away by presentActivities, and the feed should still show five.
const FETCHED_ACTIVITIES = 15;
const SHOWN_ACTIVITIES = 5;

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
        setActivities(cached.activities.slice(0, FETCHED_ACTIVITIES) as Activity[]);
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
      const res = await fetchWithTimeout(`/api/activities?limit=${FETCHED_ACTIVITIES}`, { signal: controller.signal }, 8000);
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

  const shownActivities = presentActivities(activities).slice(0, SHOWN_ACTIVITIES);

  function askCampoAI() {
    if (!userId || actionReadOnly || shownActivities.length === 0) return;
    try {
      window.sessionStorage.setItem(aiChatHandoffKey(userId), buildOperationalChatPrompt(
        shownActivities.map((activity) => ({
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
    return <p className="rounded-lg border border-border bg-card px-4 py-4 text-sm text-muted-foreground">Cargando actividad reciente…</p>;
  }

  if (loadError && activities.length === 0) {
    return (
      <div role="alert" className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-4 text-sm">
        <span className="flex-1 text-muted-foreground">{loadError}</span>
        <Button variant="ghost" size="sm" onClick={() => void loadActivities()}>
          <RefreshCw aria-hidden="true" />Reintentar
        </Button>
      </div>
    );
  }

  if (activities.length === 0) return null;

  return (
    <section aria-labelledby="recent-activity-title">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="recent-activity-title" className="text-base font-semibold">Actividad reciente</h2>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={askCampoAI} disabled={actionReadOnly || !userId} title={readOnly ? "Necesitás conexión para consultar a CampoAI" : undefined}>
            <Sparkles aria-hidden="true" />Preguntar
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/gestion/registro">Ver registro<ArrowRight aria-hidden="true" /></Link>
          </Button>
        </div>
      </div>
      {readOnly && activitySyncedAt && (
        <p role="status" className="mb-3 rounded-lg border border-warn-line bg-warn-soft px-3 py-2 text-xs text-foreground">
          Mostrando la actividad sincronizada el {new Date(activitySyncedAt).toLocaleString("es-UY")}. Modo lectura.
        </p>
      )}
      <ol className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
        {shownActivities.map((activity) => {
          const Icon = ICONS[activity.type as keyof typeof ICONS] || ClipboardList;
          const href = activityHref(activity);
          const body = (
            <>
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                <Icon className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm leading-snug">{activity.description}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  <time dateTime={activity.created_at} className="tabular-nums">{formatActivityDate(activity.created_at)}</time>
                  {activity.reported_by && <> · Por {activity.reported_by}</>}
                </span>
                {activity.raw_message && (
                  <span className="mt-1 block truncate text-xs italic text-muted-foreground">
                    {activity.message_type === "audio" && <Mic className="mr-1 inline h-3 w-3" aria-label="Audio" />}&quot;{activity.raw_message}&quot;
                  </span>
                )}
              </span>
            </>
          );
          return (
            <li key={activity.id}>
              {href ? (
                <button type="button" onClick={() => navigate(href)} className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none">
                  {body}
                  <ChevronRight className="mt-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                </button>
              ) : (
                <div className="flex items-start gap-3 px-4 py-3">{body}</div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
