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
import { ACTIVITY_FILTERS, filterActivities, type ActivityFilter } from "@/lib/activity";
import { activityHref } from "@/lib/activity";
import { isOfflineSnapshotFresh, offlineActivitySnapshotKey, parseOfflineActivitySnapshot } from "@/lib/offline";
import { useOfflineSnapshotRefresh } from "@/lib/use-offline-snapshot-refresh";
import Link from "next/link";

// ─── Types ──────────────────────────────────

interface Activity {
  id: string;
  type: string;
  description: string;
  raw_message: string | null;
  message_type: string;
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

  const headerActions = (
    <Button variant="outline" onClick={() => void refresh()} disabled={refreshing || offlineMode || !isOnline}>
      <RefreshCw className={`mr-1.5 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
      Actualizar
    </Button>
  );
  const visibleActivities = useMemo(() => filterActivities(activities, filter, query), [activities, filter, query]);
  const hasQuery = query.trim().length > 0;

  if (loading) {
    return <LoadingPage />;
  }
  if (loadError) {
    return <LoadErrorState title={offlineMode || !isOnline ? "Registro no disponible sin conexión" : "No se pudo cargar el registro"} description={loadError} onRetry={offlineMode || !isOnline ? undefined : () => void loadActivities(0, false)} />;
  }

  if (activities.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader
          breadcrumbs={[
            { label: "Gestion", href: "/gestion/inventario" },
            { label: "Registro" },
          ]}
          title="Registro de actividad"
          description="Historial cronologico de todas las acciones"
          actions={headerActions}
        />
        {activitySyncedAt && (offlineMode || !isOnline) && (
          <div role="status" className="flex items-center gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground">
            <WifiOff className="h-3.5 w-3.5 shrink-0 text-amber-500" />
            Mostrando actividad sincronizada el {new Date(activitySyncedAt).toLocaleString("es-UY")}. Modo lectura.
          </div>
        )}
        <EmptyState
          icon={ClipboardList}
          title="Sin actividad"
          description="Las actividades se registran automaticamente."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[
          { label: "Gestion", href: "/gestion/inventario" },
          { label: "Registro" },
        ]}
        title="Registro de actividad"
        description="Historial cronologico de todas las acciones"
        actions={headerActions}
      />

      {activitySyncedAt && (offlineMode || !isOnline) && (
        <div role="status" className="flex items-center gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground">
          <WifiOff className="h-3.5 w-3.5 shrink-0 text-amber-500" />
          Mostrando actividad sincronizada el {new Date(activitySyncedAt).toLocaleString("es-UY")}. Modo lectura.
        </div>
      )}

      {hasMore && (offlineMode || !isOnline) && (
        <div role="status" className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground">
          La copia offline contiene solo una parte del historial. Conectate para cargar más actividad.
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Filtrar actividad">
          {ACTIVITY_FILTERS.map((option) => (
            <Button
              key={option.value}
              size="sm"
              variant={filter === option.value ? "secondary" : "outline"}
              role="tab"
              aria-selected={filter === option.value}
              onClick={() => setFilter(option.value)}
              className="shrink-0"
            >
              {option.label}
              {option.value === "all" && <span className="ml-1.5 text-xs text-muted-foreground">{activities.length}</span>}
            </Button>
          ))}
        </div>
        <Input
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
        <div>
          {visibleActivities.map((a, index) => {
          const Icon = ACT_ICON[a.type] || ClipboardList;
          const isLast = index === visibleActivities.length - 1;
          const href = activityHref(a);

          return (
            <div key={a.id} className="flex gap-4">
              <div className="flex flex-col items-center">
                <div className="rounded-full bg-muted p-2">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                </div>
                {!isLast && <div className="flex-1 w-px bg-border mt-2" />}
              </div>
              <div className="flex-1 pb-6">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm text-foreground leading-relaxed">
                    {a.description}
                  </p>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="text-xs text-muted-foreground whitespace-nowrap tabular-nums">
                      {new Date(a.created_at).toLocaleDateString("es-AR", {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    {href && <Link href={href} className="text-xs font-medium text-primary hover:underline">Abrir</Link>}
                  </div>
                </div>
                {a.raw_message && (
                  <p className="border-l-2 border-muted pl-3 italic text-muted-foreground text-xs mt-2">
                    {a.message_type === "audio" && (
                      <Mic className="inline h-3 w-3 mr-1" />
                    )}
                    &quot;{a.raw_message}&quot;
                  </p>
                )}
              </div>
            </div>
          );
          })}
        </div>
      )}

      {hasMore && (
        <div className="flex flex-col items-center gap-2 pt-1">
          <Button variant="outline" onClick={() => void loadMore()} disabled={loadingMore || offlineMode || !isOnline}>
            {loadingMore && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {offlineMode || !isOnline ? "Conectate para cargar más" : loadingMore ? "Cargando…" : "Cargar más actividad"}
          </Button>
          {loadMoreError && (
            <p role="alert" className="text-xs text-destructive">
              No se pudo cargar la siguiente página. <button type="button" className="underline" onClick={() => void loadMore()}>Reintentar</button>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
