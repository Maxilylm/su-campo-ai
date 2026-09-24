"use client";

import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { LoadingPage } from "@/components/LoadingPage";
import { LoadErrorState } from "@/components/LoadErrorState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ArrowLeftRight,
  BarChart3,
  Heart,
  FileText,
  Settings,
  ClipboardList,
  Mic,
  Loader2,
  RefreshCw,
  WifiOff,
} from "lucide-react";
import { type LucideIcon } from "lucide-react";
import { fetchWithTimeout } from "@/lib/fetch";
import { useFarm } from "@/contexts/FarmContext";
import { DATA_CHANGED_EVENT, subscribeToAppEvent } from "@/lib/mutate";
import { ACTIVITY_FILTERS, filterActivities, formatActivityDate, type ActivityFilter, humanizeActivityDescription } from "@/lib/activity";
import { activityHref } from "@/lib/activity";
import { isOfflineSnapshotFresh, offlineActivitySnapshotKey, parseOfflineActivitySnapshot } from "@/lib/offline";
import { useOfflineSnapshotRefresh } from "@/lib/use-offline-snapshot-refresh";
import { CampoAIButton } from "@/components/CampoAIButton";
import Link from "next/link";

// ─── Types ──────────────────────────────────

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

// ─── Constants ──────────────────────────────

const ACT_ICON: Record<string, LucideIcon> = {
  movement: ArrowLeftRight,
  count_update: BarChart3,
  health: Heart,
  note: FileText,
  setup: Settings,
  registration: ClipboardList,
};

const PAGE_SIZE = 50;

// ─── Page Component ─────────────────────────

export default function RegistroPage() {
  const { userId, offlineMode, isOnline } = useFarm();
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [query, setQuery] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [nextOffset, setNextOffset] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [activitySyncedAt, setActivitySyncedAt] = useState<string | null>(null);
  const requestId = useRef(0);
  const activitiesRequestRef = useRef<AbortController | null>(null);

  const loadActivities = useCallback(async (offset = 0, append = false) => {
    const currentRequest = ++requestId.current;
    activitiesRequestRef.current?.abort();
    const controller = new AbortController();
    activitiesRequestRef.current = controller;
    if (!isOnline || offlineMode) {
      if (append) setLoadMoreError(true);
      else {
        let cached = null;
        try {
          cached = userId
            ? parseOfflineActivitySnapshot(window.localStorage.getItem(offlineActivitySnapshotKey(userId)))
            : null;
        } catch {
          cached = null;
        }
        if (cached && isOfflineSnapshotFresh(cached.savedAt)) {
          setActivities(cached.activities as Activity[]);
          setHasMore(cached.activitiesTruncated === true);
          setNextOffset(cached.activities.length);
          setActivitySyncedAt(cached.savedAt);
          setLoadError(null);
          setLoadMoreError(false);
        } else {
          setActivitySyncedAt(null);
          setLoadError("El registro de actividad requiere conexión y todavía no hay una sincronización local disponible.");
        }
        setLoading(false);
      }
      if (activitiesRequestRef.current === controller) activitiesRequestRef.current = null;
      return;
    }
    if (append) {
      setLoadMoreError(false);
    } else {
      setLoadError(null);
    }
    try {
      const res = await fetchWithTimeout(`/api/activities?limit=${PAGE_SIZE}&offset=${offset}`, { signal: controller.signal }, 8000);
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof payload.error === "string" ? payload.error : "No se pudo cargar el registro.");
      if (currentRequest !== requestId.current || controller.signal.aborted) return;
      const incoming = Array.isArray(payload) ? payload : [];
      const incomingHasMore = res.headers.get("X-Has-More") === "true";
      setActivities((current) => append ? [...current, ...incoming] : incoming);
      if (!append) {
        const savedAt = new Date().toISOString();
        setActivitySyncedAt(savedAt);
        if (userId) {
          try {
            window.localStorage.setItem(offlineActivitySnapshotKey(userId), JSON.stringify({ activities: incoming, activitiesTruncated: incomingHasMore, savedAt }));
          } catch {
            // Storage is optional; the online activity log remains usable.
          }
        }
      }
      setHasMore(incomingHasMore);
      const parsedNextOffset = Number(res.headers.get("X-Next-Offset"));
      setNextOffset(Number.isFinite(parsedNextOffset) ? parsedNextOffset : offset + incoming.length);
    } catch (e) {
      if (controller.signal.aborted || (e instanceof Error && e.name === "AbortError")) return;
      console.error("Load activities error:", e);
      if (currentRequest === requestId.current) {
        if (append) setLoadMoreError(true);
        else setLoadError(e instanceof Error ? e.message : "No se pudo cargar el registro.");
      }
    } finally {
      if (currentRequest === requestId.current && !controller.signal.aborted && !append) setLoading(false);
      if (activitiesRequestRef.current === controller) activitiesRequestRef.current = null;
    }
  }, [isOnline, offlineMode, userId]);

  useEffect(() => {
    void loadActivities();
    return () => activitiesRequestRef.current?.abort();
  }, [loadActivities]);
  const refreshOfflineActivity = useCallback(() => loadActivities(0, false), [loadActivities]);
  useOfflineSnapshotRefresh(refreshOfflineActivity, userId, offlineMode || !isOnline);

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

  async function refresh() {
    setRefreshing(true);
    try {
      await loadActivities(0, false);
    } finally {
      setRefreshing(false);
    }
  }

  async function loadMore() {
    if (offlineMode || !isOnline) return;
    setLoadingMore(true);
    try {
      await loadActivities(nextOffset, true);
    } finally {
      setLoadingMore(false);
    }
  }

  const visibleActivities = useMemo(() => filterActivities(activities, filter, query), [activities, filter, query]);
  const hasQuery = query.trim().length > 0;
  const offlineReadOnly = offlineMode || !isOnline;
  const activityAIFacts = [
    `Filtro: ${filter}${hasQuery ? `, búsqueda «${query.trim()}»` : ""}`,
    `Eventos visibles: ${visibleActivities.length}${hasMore ? "+" : ""}`,
    ...visibleActivities.slice(0, 30).map((activity) => `${activity.created_at}: ${activity.type} — ${humanizeActivityDescription(activity)}`),
  ];
  const header = (
    <PageHeader
      title="Registro de actividad"
      description="Historial cronológico de lo que se cargó y cambió en el campo."
      actions={
        <>
          <CampoAIButton title="Registro de actividad" facts={activityAIFacts} partial={hasMore} instruction="Usá la actividad reciente para explicar qué cambió en el campo y qué seguimiento conviene revisar en los módulos relacionados." disabled={activities.length === 0} />
          <Button variant="outline" onClick={() => void refresh()} disabled={refreshing || offlineReadOnly}>
            <RefreshCw className={refreshing ? "animate-spin" : undefined} aria-hidden="true" />
            Actualizar
          </Button>
        </>
      }
    />
  );
  const offlineNotice = activitySyncedAt && offlineReadOnly && (
    <div role="status" className="flex items-center gap-2 rounded-lg border border-warn-line bg-warn-soft px-3 py-2 text-sm text-foreground">
      <WifiOff className="h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
      Mostrando la actividad sincronizada el {new Date(activitySyncedAt).toLocaleString("es-UY")}. Modo lectura.
    </div>
  );

  if (loading) {
    return <LoadingPage />;
  }
  if (loadError) {
    return (
      <div className="space-y-6">
        {header}
        <LoadErrorState title={offlineReadOnly ? "Registro no disponible sin conexión" : "No se pudo cargar el registro"} description={loadError} onRetry={offlineReadOnly ? undefined : () => void loadActivities(0, false)} />
      </div>
    );
  }

  if (activities.length === 0) {
    return (
      <div className="space-y-6">
        {header}
        {offlineNotice}
        <EmptyState
          icon={ClipboardList}
          title="Todavía no hay actividad"
          description="Cada carga, movimiento de hacienda o mensaje a CampoAI queda registrado acá automáticamente."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}
      {offlineNotice}

      {hasMore && offlineReadOnly && (
        <div role="status" className="rounded-lg border border-warn-line bg-warn-soft px-3 py-2 text-sm text-foreground">
          La copia offline tiene solo una parte del historial. Conectate para cargar más actividad.
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Filtrar actividad">
          {ACTIVITY_FILTERS.map((option) => (
            <Button
              key={option.value}
              size="sm"
              variant={filter === option.value ? "secondary" : "ghost"}
              role="tab"
              aria-selected={filter === option.value}
              onClick={() => setFilter(option.value)}
              className={filter === option.value ? "shrink-0 text-foreground" : "shrink-0 text-muted-foreground"}
            >
              {option.label}
              {option.value === "all" && <span className="figure text-xs text-muted-foreground">{activities.length}{hasMore ? "+" : ""}</span>}
            </Button>
          ))}
        </div>
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar en el registro…"
          aria-label="Buscar en el registro"
          className="sm:max-w-xs"
        />
      </div>

      {visibleActivities.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title={hasQuery ? "Sin coincidencias" : "Sin actividad en este filtro"}
          description={hasQuery
            ? hasMore ? "No hay coincidencias en los eventos cargados. Cargá más para ampliar la búsqueda." : "Probá con otra palabra o limpiá la búsqueda para ver más eventos."
            : "Elegí otra categoría para consultar el resto del historial."}
        />
      ) : (
        <ol className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
          {visibleActivities.map((a) => {
            const Icon = ACT_ICON[a.type] || ClipboardList;
            const href = activityHref(a);
            return (
              <li key={a.id} className="flex items-start gap-3 px-4 py-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-relaxed">{humanizeActivityDescription(a)}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    <time dateTime={a.created_at} className="tabular-nums">{formatActivityDate(a.created_at)}</time>
                    {a.reported_by && <> · Por {a.reported_by}</>}
                  </p>
                  {a.raw_message && (
                    <p className="mt-2 border-l-2 border-border pl-3 text-xs italic text-muted-foreground">
                      {a.message_type === "audio" && <Mic className="mr-1 inline h-3 w-3" aria-label="Audio" />}
                      &quot;{a.raw_message}&quot;
                    </p>
                  )}
                </div>
                {href && (
                  <Button variant="ghost" size="sm" asChild className="shrink-0">
                    <Link href={href}>Abrir</Link>
                  </Button>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {hasMore && (
        <div className="flex flex-col items-center gap-2 pt-1">
          <Button variant="outline" onClick={() => void loadMore()} disabled={loadingMore || offlineReadOnly}>
            {loadingMore && <Loader2 className="animate-spin" aria-hidden="true" />}
            {offlineReadOnly ? "Conectate para cargar más" : loadingMore ? "Cargando…" : "Cargar más actividad"}
          </Button>
          {loadMoreError && (
            <p role="alert" className="text-sm text-bad">
              No se pudo cargar la siguiente página. {!offlineMode && isOnline && <button type="button" className="font-medium underline" onClick={() => void loadMore()}>Reintentar</button>}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
