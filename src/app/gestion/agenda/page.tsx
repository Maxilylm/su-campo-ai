"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CalendarDays, List, RefreshCw, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { LoadingPage } from "@/components/LoadingPage";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/gestion/SegmentedControl";
import { AgendaCalendarView } from "@/components/agenda/AgendaCalendarView";
import { useAgendaView, type AgendaView } from "@/components/agenda/useAgendaView";
import { useFarm } from "@/contexts/FarmContext";
import { fetchWithTimeout } from "@/lib/fetch";
import {
  adjustAgendaToLocalDay,
  agendaWindowHorizon,
  buildAgenda,
  countOverdueBefore,
  filterAgendaWindow,
  groupAgendaByDay,
  taskIdFromAgendaItemId,
  type AgendaInputs,
  type AgendaItem,
  type AgendaWindow,
} from "@/lib/agenda";
import { monthGridRange, monthOf, monthTitle, type MonthRef } from "@/lib/calendar-grid";
import { useDataChangedRefresh } from "@/lib/use-data-changed-refresh";
import { useOfflineSnapshotRefresh } from "@/lib/use-offline-snapshot-refresh";
import { isOfflineSnapshotFresh, offlineAgendaSnapshotKey, offlineEntitySnapshotKey, parseOfflineAgendaSnapshot, parseOfflineEntitySnapshot } from "@/lib/offline";
import { sendJsonResult } from "@/lib/mutate";
import { dateInputValue } from "@/lib/date";
import { snoozeDueDate } from "@/lib/tasks";
import { toast } from "sonner";
import { AgendaItemRow } from "@/components/AgendaItemRow";
import { aiChatHandoffKey, buildOperationalChatPrompt } from "@/lib/ai-handoff";
import { useOfflineAwareNavigation } from "@/lib/use-offline-aware-navigation";
import { cn } from "@/lib/utils";

const HORIZONS = [30, 60, 90] as const;
const VIEW_OPTIONS = [
  { value: "list", label: "Lista", icon: List },
  { value: "calendar", label: "Calendario", icon: CalendarDays },
] as const;
const AGENDA_SOURCE_DETAILS: Record<string, { label: string; href: string }> = {
  tasks: { label: "Tareas", href: "/api/export?format=csv&table=tasks" },
  vaccinations: { label: "Vacunaciones", href: "/api/export?format=csv&table=vaccinations" },
  crops: { label: "Cultivos", href: "/api/export?format=csv&table=crops" },
};

/** List: overdue plus the next N days. Calendar: exactly the visible grid. */
type AgendaQuery = { kind: "horizon"; days: number } | { kind: "window"; window: AgendaWindow };

function dayLabel(date: string, daysFromNow: number): string {
  if (daysFromNow === 0) return "Hoy";
  if (daysFromNow === 1) return "Mañana";
  const label = new Date(`${date}T12:00:00Z`).toLocaleDateString("es-UY", { weekday: "long", day: "numeric", month: "long" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export default function AgendaPage() {
  const { userId, offlineMode, isOnline, readOnly: permissionReadOnly } = useFarm();
  const navigate = useOfflineAwareNavigation();
  const offlineReadOnly = offlineMode || !isOnline;
  const actionReadOnly = offlineReadOnly || permissionReadOnly;
  const [view, setView] = useAgendaView(userId);
  const [items, setItems] = useState<AgendaItem[]>([]);
  const [horizon, setHorizon] = useState<(typeof HORIZONS)[number]>(60);
  const [month, setMonth] = useState<MonthRef>(() => monthOf(dateInputValue()));
  const [overdueBeforeWindow, setOverdueBeforeWindow] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [migrationRequired, setMigrationRequired] = useState(false);
  const [truncatedSources, setTruncatedSources] = useState<string[]>([]);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [completingTaskId, setCompletingTaskId] = useState<string | null>(null);
  const [snoozingTaskId, setSnoozingTaskId] = useState<string | null>(null);
  const agendaRequestId = useRef(0);
  const agendaRequestRef = useRef<AbortController | null>(null);
  // The first load, a view switch and a horizon change show the loading page;
  // later refreshes (month navigation, mutations) keep the content on screen
  // so an open day panel and keyboard focus survive.
  const hardReload = useRef(true);

  const applyItems = useCallback((localItems: AgendaItem[], query: AgendaQuery, serverOverdueBefore?: number) => {
    if (query.kind === "window") {
      const today = dateInputValue();
      setItems(filterAgendaWindow(localItems, query.window));
      setOverdueBeforeWindow(serverOverdueBefore ?? countOverdueBefore(localItems, query.window.from < today ? query.window.from : today));
    } else {
      setItems(localItems);
      setOverdueBeforeWindow(0);
    }
  }, []);

  const loadAgenda = useCallback(async (query: AgendaQuery) => {
    const currentRequest = ++agendaRequestId.current;
    agendaRequestRef.current?.abort();
    const soft = !hardReload.current;
    hardReload.current = false;
    setLoadError(null);
    setTruncatedSources([]);
    if (offlineReadOnly) {
      const today = dateInputValue();
      const days = query.kind === "window" ? agendaWindowHorizon(query.window, today) : query.days;
      let entitySnapshot = null;
      let taskSnapshot = null;
      try {
        if (userId) {
          entitySnapshot = parseOfflineEntitySnapshot(window.localStorage.getItem(offlineEntitySnapshotKey(userId)));
          taskSnapshot = parseOfflineAgendaSnapshot(window.localStorage.getItem(offlineAgendaSnapshotKey(userId)));
        }
      } catch {
        entitySnapshot = null;
        taskSnapshot = null;
      }
      if (entitySnapshot && isOfflineSnapshotFresh(entitySnapshot.savedAt)) {
        applyItems(adjustAgendaToLocalDay(buildAgenda({
          vaccinations: entitySnapshot.vaccinations as AgendaInputs["vaccinations"],
          crops: entitySnapshot.crops as AgendaInputs["crops"],
          tasks: entitySnapshot.tasks as AgendaInputs["tasks"],
        }, Date.now(), days), today), query);
        setMigrationRequired(false);
        setTruncatedSources([
          ...(entitySnapshot.vaccinationsTruncated ? ["vaccinations"] : []),
          ...(entitySnapshot.cropsTruncated ? ["crops"] : []),
          ...(entitySnapshot.tasksTruncated ? ["tasks"] : []),
        ]);
        setSyncedAt(entitySnapshot.savedAt);
      } else if (taskSnapshot && isOfflineSnapshotFresh(taskSnapshot.savedAt)) {
        applyItems(adjustAgendaToLocalDay(buildAgenda({ vaccinations: [], crops: taskSnapshot.crops as AgendaInputs["crops"], tasks: taskSnapshot.tasks as AgendaInputs["tasks"] }, Date.now(), days), today), query);
        setMigrationRequired(taskSnapshot.migrationRequired === true);
        setTruncatedSources(taskSnapshot.tasksTruncated ? ["tasks"] : []);
        setSyncedAt(taskSnapshot.savedAt);
      } else {
        setLoadError("La agenda requiere conexión y todavía no hay una sincronización local disponible.");
      }
      setLoaded(true);
      setFetching(false);
      return;
    }

    if (soft) setFetching(true);
    else setLoaded(false);
    const controller = new AbortController();
    agendaRequestRef.current = controller;
    const url = query.kind === "window"
      ? `/api/agenda?from=${query.window.from}&to=${query.window.to}`
      : `/api/agenda?days=${query.days}`;
    try {
      const response = await fetchWithTimeout(url, { cache: "no-store", signal: controller.signal }, 8000);
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "No se pudo cargar la agenda.");
      if (currentRequest !== agendaRequestId.current || controller.signal.aborted) return;
      const serverOverdueBefore = Number(payload?.overdueBeforeWindow);
      applyItems(
        adjustAgendaToLocalDay(Array.isArray(payload?.items) ? payload.items : [], dateInputValue()),
        query,
        Number.isFinite(serverOverdueBefore) ? serverOverdueBefore : undefined,
      );
      setMigrationRequired(payload?.migrationRequired === true);
      const payloadSources = Array.isArray(payload?.truncatedSources)
        ? payload.truncatedSources.filter((source: unknown): source is string => typeof source === "string")
        : [
          ...(payload?.vaccinationsTruncated ? ["vaccinations"] : []),
          ...(payload?.cropsTruncated ? ["crops"] : []),
          ...(payload?.tasksTruncated ? ["tasks"] : []),
        ];
      setTruncatedSources(payloadSources);
      setSyncedAt(new Date().toISOString());
    } catch (error) {
      if (controller.signal.aborted) return;
      setLoadError(error instanceof Error ? error.message : "No se pudo cargar la agenda.");
    } finally {
      if (currentRequest === agendaRequestId.current) {
        setLoaded(true);
        setFetching(false);
        if (agendaRequestRef.current === controller) agendaRequestRef.current = null;
      }
    }
  }, [applyItems, offlineReadOnly, userId]);

  const { start: gridStart, end: gridEnd } = monthGridRange(month);
  const refreshCurrentAgenda = useCallback(async () => {
    if (!view) return;
    await loadAgenda(view === "calendar" ? { kind: "window", window: { from: gridStart, to: gridEnd } } : { kind: "horizon", days: horizon });
  }, [gridEnd, gridStart, horizon, loadAgenda, view]);
  useEffect(() => {
    void refreshCurrentAgenda();
    return () => {
      agendaRequestId.current += 1;
      agendaRequestRef.current?.abort();
    };
  }, [refreshCurrentAgenda]);
  useDataChangedRefresh(refreshCurrentAgenda, !offlineReadOnly);
  useOfflineSnapshotRefresh(refreshCurrentAgenda, userId, offlineReadOnly);

  function changeView(next: AgendaView) {
    if (next === view) return;
    hardReload.current = true;
    setView(next);
  }

  function changeHorizon(next: (typeof HORIZONS)[number]) {
    if (next === horizon) return;
    hardReload.current = true;
    setHorizon(next);
  }

  async function completeTask(item: AgendaItem) {
    if (actionReadOnly || item.kind !== "task") return;
    const taskId = taskIdFromAgendaItemId(item.id);
    if (!taskId) return;
    setCompletingTaskId(taskId);
    try {
      const result = await sendJsonResult("/api/tasks", "PUT", { id: taskId, status: "completed" });
      if (result.ok) {
        setItems((current) => current.filter((entry) => entry.id !== item.id));
        toast.success("Tarea completada");
      } else {
        toast.error(result.error || "No se pudo completar la tarea");
      }
    } catch {
      toast.error("No se pudo completar la tarea");
    } finally {
      setCompletingTaskId(null);
    }
  }

  async function snoozeTask(item: AgendaItem) {
    if (actionReadOnly || item.kind !== "task") return;
    const taskId = taskIdFromAgendaItemId(item.id);
    const nextDate = snoozeDueDate(item.date, dateInputValue());
    if (!taskId || !nextDate) return;
    setSnoozingTaskId(taskId);
    try {
      const result = await sendJsonResult("/api/tasks", "PUT", { id: taskId, dueDate: nextDate });
      if (result.ok) {
        await refreshCurrentAgenda();
        toast.success(`Tarea postergada al ${new Date(`${nextDate}T12:00:00`).toLocaleDateString("es-UY")}`);
      } else {
        toast.error(result.error || "No se pudo postergar la tarea");
      }
    } catch {
      toast.error("No se pudo postergar la tarea");
    } finally {
      setSnoozingTaskId(null);
    }
  }

  if (!loaded || !view) return <LoadingPage />;

  const { overdue, days } = groupAgendaByDay(items);
  function askCampoAI() {
    if (!userId || offlineReadOnly || items.length === 0) return;
    try {
      window.sessionStorage.setItem(aiChatHandoffKey(userId), buildOperationalChatPrompt(
        items.slice(0, 30).map((item) => ({
          label: `${item.kind === "task" ? "Tarea" : item.kind === "vaccination" ? "Vacunación" : "Cosecha"}: ${item.title}`,
          detail: `${item.date}${item.detail ? ` · ${item.detail}` : ""}`,
        })),
        view === "calendar" ? `la agenda de ${monthTitle(month).toLowerCase()}` : "la agenda completa",
      ));
    } catch {
      // Chat remains available even when session storage is unavailable.
    }
    navigate("/chat?from=agenda");
  }

  const header = (
    <PageHeader
      title="Agenda"
      description="Tareas, vacunaciones y cosechas de los próximos días, en un solo calendario."
      actions={<Button variant="outline" onClick={askCampoAI} disabled={offlineReadOnly || items.length === 0} title={offlineReadOnly ? "Necesitás conexión para consultar a CampoAI" : undefined}><Sparkles aria-hidden="true" />Analizar con CampoAI</Button>}
    />
  );

  if (loadError) {
    return <div className="space-y-6">{header}<EmptyState icon={AlertTriangle} title={offlineReadOnly ? "Agenda no disponible sin conexión" : "No se pudo cargar la agenda"} description={offlineReadOnly ? "Conectate a internet y sincronizá Mi campo para consultar la agenda." : loadError} actionLabel={offlineReadOnly ? undefined : "Reintentar"} onAction={offlineReadOnly ? undefined : () => void refreshCurrentAgenda()} /></div>;
  }

  const renderRow = (item: AgendaItem) => (
    <AgendaItemRow key={item.id} item={item} onComplete={completeTask} completing={completingTaskId === taskIdFromAgendaItemId(item.id)} onSnooze={snoozeTask} snoozing={snoozingTaskId === taskIdFromAgendaItemId(item.id)} readOnly={actionReadOnly} />
  );

  return (
    <div className="space-y-6">
      {header}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl label="Vista" options={VIEW_OPTIONS} value={view} onChange={changeView} />
          {view === "list" && (
            <div role="group" aria-label="Período" className="inline-flex rounded-md border border-border bg-card p-0.5">
              {HORIZONS.map((value) => (
                <button
                  type="button"
                  key={value}
                  aria-pressed={horizon === value}
                  onClick={() => changeHorizon(value)}
                  className={cn(
                    "rounded-[calc(var(--radius)-3px)] px-3 py-1.5 text-sm outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
                    horizon === value ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <span className="figure">{value}</span> días
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span><span className="figure font-semibold text-foreground">{items.length}</span> {items.length === 1 ? "pendiente" : "pendientes"}</span>
          {syncedAt && <span className="text-xs">· Actualizada {new Date(syncedAt).toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit" })}</span>}
          <Button variant="ghost" size="icon" aria-label="Actualizar agenda" onClick={() => void refreshCurrentAgenda()} disabled={offlineReadOnly || fetching}><RefreshCw className={fetching ? "animate-spin" : undefined} aria-hidden="true" /></Button>
        </div>
      </div>

      {migrationRequired && <div role="status" className="rounded-lg border border-warn-line bg-warn-soft px-3 py-2 text-sm text-warn">Las tareas todavía no aparecen en la agenda: aplicá la migración <code>014_tasks.sql</code> para incluirlas.</div>}

      {truncatedSources.length > 0 && <div role="status" className="rounded-lg border border-warn-line bg-warn-soft px-3 py-2 text-sm text-foreground">La agenda muestra solo una parte de algunas fuentes para cargar rápido. Descargá el conjunto completo: {truncatedSources.map((source, index) => {
        const detail = AGENDA_SOURCE_DETAILS[source];
        if (!detail) return null;
        return <span key={source}>{index > 0 ? ", " : ""}<a href={detail.href} className="font-medium text-primary underline-offset-2 hover:underline">{detail.label} (CSV)</a></span>;
      })}.</div>}

      {view === "calendar" ? (
        <AgendaCalendarView
          month={month}
          onMonthChange={setMonth}
          today={dateInputValue()}
          items={items}
          renderRow={renderRow}
          overdueBeforeWindow={overdueBeforeWindow}
          onShowList={() => changeView("list")}
          busy={fetching}
        />
      ) : items.length === 0 ? <EmptyState icon={CalendarDays} title="Agenda despejada" description="No hay tareas, vacunaciones ni cosechas programadas en este período. Cargá una tarea en Tareas para verla acá." actionLabel="Ir a Tareas" onAction={() => navigate("/gestion/tareas")} /> : (
        <div className="space-y-8">
          {overdue.length > 0 && (
            <section aria-labelledby="agenda-overdue">
              <h2 id="agenda-overdue" className="mb-3 flex items-center gap-2 text-base font-semibold text-bad">
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />Atrasado
                <span className="figure text-sm font-normal">{overdue.length}</span>
              </h2>
              <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">{overdue.map(renderRow)}</div>
            </section>
          )}
          {days.map((group) => (
            <section key={group.date} aria-labelledby={`agenda-${group.date}`}>
              <h2 id={`agenda-${group.date}`} className="mb-3 text-base font-semibold">
                {dayLabel(group.date, group.items[0].daysFromNow)}
                {group.items[0].daysFromNow > 1 && <span className="ml-2 text-sm font-normal text-muted-foreground">en {group.items[0].daysFromNow} días</span>}
              </h2>
              <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">{group.items.map(renderRow)}</div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
