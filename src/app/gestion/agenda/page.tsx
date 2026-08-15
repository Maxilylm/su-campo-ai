"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CalendarDays, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { LoadingPage } from "@/components/LoadingPage";
import { Button } from "@/components/ui/button";
import { useFarm } from "@/contexts/FarmContext";
import { fetchWithTimeout } from "@/lib/fetch";
import { adjustAgendaToLocalDay, buildAgenda, groupAgendaByDay, taskIdFromAgendaItemId, type AgendaInputs, type AgendaItem } from "@/lib/agenda";
import { useDataChangedRefresh } from "@/lib/use-data-changed-refresh";
import { useOfflineSnapshotRefresh } from "@/lib/use-offline-snapshot-refresh";
import { isOfflineSnapshotFresh, offlineAgendaSnapshotKey, offlineEntitySnapshotKey, parseOfflineAgendaSnapshot, parseOfflineEntitySnapshot } from "@/lib/offline";
import { sendJsonResult } from "@/lib/mutate";
import { addCalendarDays } from "@/lib/date";
import { toast } from "sonner";
import { AgendaItemRow } from "@/components/AgendaItemRow";

const HORIZONS = [30, 60, 90] as const;
const AGENDA_SOURCE_DETAILS: Record<string, { label: string; href: string }> = {
  tasks: { label: "Tareas", href: "/api/export?format=csv&table=tasks" },
  vaccinations: { label: "Vacunaciones", href: "/api/export?format=csv&table=vaccinations" },
  crops: { label: "Cultivos", href: "/api/export?format=csv&table=crops" },
};

function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function dayLabel(date: string, daysFromNow: number): string {
  if (daysFromNow === 0) return "Hoy";
  if (daysFromNow === 1) return "Mañana";
  const label = new Date(`${date}T12:00:00Z`).toLocaleDateString("es-UY", { weekday: "long", day: "numeric", month: "long" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export default function AgendaPage() {
  const { userId, offlineMode, isOnline } = useFarm();
  const readOnly = offlineMode || !isOnline;
  const [items, setItems] = useState<AgendaItem[]>([]);
  const [horizon, setHorizon] = useState<(typeof HORIZONS)[number]>(60);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [migrationRequired, setMigrationRequired] = useState(false);
  const [truncatedSources, setTruncatedSources] = useState<string[]>([]);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [completingTaskId, setCompletingTaskId] = useState<string | null>(null);
  const [snoozingTaskId, setSnoozingTaskId] = useState<string | null>(null);
  const agendaRequestId = useRef(0);
  const agendaRequestRef = useRef<AbortController | null>(null);

  const loadAgenda = useCallback(async (days: number) => {
    const currentRequest = ++agendaRequestId.current;
    agendaRequestRef.current?.abort();
    setLoadError(null);
    setTruncatedSources([]);
    if (readOnly) {
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
        setItems(adjustAgendaToLocalDay(buildAgenda({
          vaccinations: entitySnapshot.vaccinations as AgendaInputs["vaccinations"],
          crops: entitySnapshot.crops as AgendaInputs["crops"],
          tasks: entitySnapshot.tasks as AgendaInputs["tasks"],
        }, Date.now(), days), localToday()));
        setMigrationRequired(false);
        setTruncatedSources([
          ...(entitySnapshot.vaccinationsTruncated ? ["vaccinations"] : []),
          ...(entitySnapshot.cropsTruncated ? ["crops"] : []),
          ...(entitySnapshot.tasksTruncated ? ["tasks"] : []),
        ]);
        setSyncedAt(entitySnapshot.savedAt);
      } else if (taskSnapshot && isOfflineSnapshotFresh(taskSnapshot.savedAt)) {
        setItems(adjustAgendaToLocalDay(buildAgenda({ vaccinations: [], crops: taskSnapshot.crops as AgendaInputs["crops"], tasks: taskSnapshot.tasks as AgendaInputs["tasks"] }, Date.now(), days), localToday()));
        setMigrationRequired(taskSnapshot.migrationRequired === true);
        setTruncatedSources(taskSnapshot.tasksTruncated ? ["tasks"] : []);
        setSyncedAt(taskSnapshot.savedAt);
      } else {
        setLoadError("La agenda requiere conexión y todavía no hay una sincronización local disponible.");
      }
      setLoaded(true);
      return;
    }

    setLoaded(false);
    const controller = new AbortController();
    agendaRequestRef.current = controller;
    try {
      const response = await fetchWithTimeout(`/api/agenda?days=${days}`, { cache: "no-store", signal: controller.signal }, 8000);
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "No se pudo cargar la agenda.");
      if (currentRequest !== agendaRequestId.current || controller.signal.aborted) return;
      setItems(adjustAgendaToLocalDay(Array.isArray(payload?.items) ? payload.items : [], localToday()));
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
        if (agendaRequestRef.current === controller) agendaRequestRef.current = null;
      }
    }
  }, [readOnly, userId]);

  const refreshCurrentAgenda = useCallback(() => loadAgenda(horizon), [horizon, loadAgenda]);
  useEffect(() => {
    void refreshCurrentAgenda();
    return () => {
      agendaRequestId.current += 1;
      agendaRequestRef.current?.abort();
    };
  }, [refreshCurrentAgenda]);
  useDataChangedRefresh(refreshCurrentAgenda, !readOnly);
  useOfflineSnapshotRefresh(refreshCurrentAgenda, userId, readOnly);

  async function completeTask(item: AgendaItem) {
    if (readOnly || item.kind !== "task") return;
    const taskId = taskIdFromAgendaItemId(item.id);
    if (!taskId) return;
    setCompletingTaskId(taskId);
    const result = await sendJsonResult("/api/tasks", "PUT", { id: taskId, status: "completed" });
    if (result.ok) {
      setItems((current) => current.filter((entry) => entry.id !== item.id));
      toast.success("Tarea completada");
    } else {
      toast.error(result.error || "No se pudo completar la tarea");
    }
    setCompletingTaskId(null);
  }

  async function snoozeTask(item: AgendaItem) {
    if (readOnly || item.kind !== "task") return;
    const taskId = taskIdFromAgendaItemId(item.id);
    const nextDate = addCalendarDays(item.date, 1);
    if (!taskId || !nextDate) return;
    setSnoozingTaskId(taskId);
    const result = await sendJsonResult("/api/tasks", "PUT", { id: taskId, dueDate: nextDate });
    if (result.ok) {
      await loadAgenda(horizon);
      toast.success(`Tarea postergada al ${new Date(`${nextDate}T12:00:00`).toLocaleDateString("es-UY")}`);
    } else {
      toast.error(result.error || "No se pudo postergar la tarea");
    }
    setSnoozingTaskId(null);
  }

  if (!loaded) return <LoadingPage />;

  const { overdue, days } = groupAgendaByDay(items);
  const header = <PageHeader breadcrumbs={[{ label: "Gestión", href: "/gestion/inventario" }, { label: "Agenda" }]} title="Agenda" description="Plan de trabajo unificado para los próximos días" />;

  if (loadError) {
    return <div className="space-y-6">{header}<EmptyState icon={AlertTriangle} title="No se pudo cargar la agenda" description={loadError} actionLabel="Reintentar" onAction={() => void loadAgenda(horizon)} /></div>;
  }

  return (
    <div className="space-y-6">
      {header}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1">
          {HORIZONS.map((value) => <Button key={value} variant={horizon === value ? "secondary" : "ghost"} size="sm" onClick={() => setHorizon(value)}>{value} días</Button>)}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{items.length} {items.length === 1 ? "pendiente" : "pendientes"}</span>
          {syncedAt && <span>· Actualizada {new Date(syncedAt).toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit" })}</span>}
          <Button variant="ghost" size="icon" aria-label="Actualizar agenda" onClick={() => void loadAgenda(horizon)} disabled={readOnly}><RefreshCw className="h-4 w-4" /></Button>
        </div>
      </div>

      {migrationRequired && <div role="status" className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground">Las tareas no están disponibles todavía. Aplicá la migración <code>014_tasks.sql</code> para incluirlas en la agenda.</div>}

      {truncatedSources.length > 0 && <div role="status" className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground">La agenda muestra solo una parte de algunas fuentes para mantener la carga rápida. Consultá el conjunto completo: {truncatedSources.map((source, index) => {
        const detail = AGENDA_SOURCE_DETAILS[source];
        if (!detail) return null;
        return <span key={source}>{index > 0 ? ", " : ""}<a href={detail.href} className="font-medium text-primary underline-offset-2 hover:underline">{detail.label} CSV</a></span>;
      })}.</div>}

      {items.length === 0 ? <EmptyState icon={CalendarDays} title="Agenda despejada" description="No hay tareas, vacunaciones ni cosechas programadas en este periodo." /> : (
        <div className="space-y-6">
          {overdue.length > 0 && <section className="space-y-2"><h2 className="flex items-center gap-2 text-sm font-semibold text-red-600 dark:text-red-400"><AlertTriangle className="h-4 w-4" /> Atrasado</h2><div className="space-y-2">{overdue.map((item) => <AgendaItemRow key={item.id} item={item} onComplete={completeTask} completing={completingTaskId === taskIdFromAgendaItemId(item.id)} onSnooze={snoozeTask} snoozing={snoozingTaskId === taskIdFromAgendaItemId(item.id)} readOnly={readOnly} />)}</div></section>}
          {days.map((group) => <section key={group.date} className="space-y-2"><h2 className="text-sm font-semibold">{dayLabel(group.date, group.items[0].daysFromNow)}<span className="ml-2 font-normal text-muted-foreground">{group.items[0].daysFromNow > 1 ? `en ${group.items[0].daysFromNow} días` : ""}</span></h2><div className="space-y-2">{group.items.map((item) => <AgendaItemRow key={item.id} item={item} onComplete={completeTask} completing={completingTaskId === taskIdFromAgendaItemId(item.id)} onSnooze={snoozeTask} snoozing={snoozingTaskId === taskIdFromAgendaItemId(item.id)} readOnly={readOnly} />)}</div></section>)}
        </div>
      )}
    </div>
  );
}
