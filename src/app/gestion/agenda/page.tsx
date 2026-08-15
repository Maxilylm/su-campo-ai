"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CalendarDays, CheckSquare, ChevronRight, RefreshCw, Syringe, Wheat } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { LoadingPage } from "@/components/LoadingPage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useFarm } from "@/contexts/FarmContext";
import { fetchWithTimeout } from "@/lib/fetch";
import { adjustAgendaToLocalDay, buildAgenda, groupAgendaByDay, type AgendaInputs, type AgendaItem } from "@/lib/agenda";
import { useDataChangedRefresh } from "@/lib/use-data-changed-refresh";
import { isOfflineSnapshotFresh, offlineAgendaSnapshotKey, offlineEntitySnapshotKey, parseOfflineAgendaSnapshot, parseOfflineEntitySnapshot } from "@/lib/offline";

const HORIZONS = [30, 60, 90] as const;
const KIND_ICON = { task: CheckSquare, vaccination: Syringe, harvest: Wheat } as const;
const KIND_COLOR = {
  task: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
  vaccination: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
  harvest: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
} as const;

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

function AgendaRow({ item }: { item: AgendaItem }) {
  const Icon = KIND_ICON[item.kind];
  return (
    <Link href={item.href} className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:bg-accent/50">
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${KIND_COLOR[item.kind]}`}>
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{item.title}</span>
        <span className="block truncate text-xs text-muted-foreground">{item.detail}</span>
      </span>
      {item.priority === "high" && <Badge variant="destructive" className="shrink-0">Alta</Badge>}
      {item.daysFromNow < 0 && <Badge variant="destructive" className="shrink-0">{Math.abs(item.daysFromNow)}d atrasado</Badge>}
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}

export default function AgendaPage() {
  const { userId, offlineMode, isOnline } = useFarm();
  const readOnly = offlineMode || !isOnline;
  const [items, setItems] = useState<AgendaItem[]>([]);
  const [horizon, setHorizon] = useState<(typeof HORIZONS)[number]>(60);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [migrationRequired, setMigrationRequired] = useState(false);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);

  const loadAgenda = useCallback(async (days: number) => {
    setLoadError(null);
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
        setSyncedAt(entitySnapshot.savedAt);
      } else if (taskSnapshot && isOfflineSnapshotFresh(taskSnapshot.savedAt)) {
        setItems(adjustAgendaToLocalDay(buildAgenda({ vaccinations: [], crops: taskSnapshot.crops as AgendaInputs["crops"], tasks: taskSnapshot.tasks as AgendaInputs["tasks"] }, Date.now(), days), localToday()));
        setMigrationRequired(taskSnapshot.migrationRequired === true);
        setSyncedAt(taskSnapshot.savedAt);
      } else {
        setLoadError("La agenda requiere conexión y todavía no hay una sincronización local disponible.");
      }
      setLoaded(true);
      return;
    }

    setLoaded(false);
    try {
      const response = await fetchWithTimeout(`/api/agenda?days=${days}`, {}, 8000);
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "No se pudo cargar la agenda.");
      setItems(adjustAgendaToLocalDay(Array.isArray(payload?.items) ? payload.items : [], localToday()));
      setMigrationRequired(payload?.migrationRequired === true);
      setSyncedAt(new Date().toISOString());
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "No se pudo cargar la agenda.");
    } finally {
      setLoaded(true);
    }
  }, [readOnly, userId]);

  const refreshCurrentAgenda = useCallback(() => loadAgenda(horizon), [horizon, loadAgenda]);
  useEffect(() => { void refreshCurrentAgenda(); }, [refreshCurrentAgenda]);
  useDataChangedRefresh(refreshCurrentAgenda, !readOnly);

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

      {items.length === 0 ? <EmptyState icon={CalendarDays} title="Agenda despejada" description="No hay tareas, vacunaciones ni cosechas programadas en este periodo." /> : (
        <div className="space-y-6">
          {overdue.length > 0 && <section className="space-y-2"><h2 className="flex items-center gap-2 text-sm font-semibold text-red-600 dark:text-red-400"><AlertTriangle className="h-4 w-4" /> Atrasado</h2><div className="space-y-2">{overdue.map((item) => <AgendaRow key={item.id} item={item} />)}</div></section>}
          {days.map((group) => <section key={group.date} className="space-y-2"><h2 className="text-sm font-semibold">{dayLabel(group.date, group.items[0].daysFromNow)}<span className="ml-2 font-normal text-muted-foreground">{group.items[0].daysFromNow > 1 ? `en ${group.items[0].daysFromNow} días` : ""}</span></h2><div className="space-y-2">{group.items.map((item) => <AgendaRow key={item.id} item={item} />)}</div></section>)}
        </div>
      )}
    </div>
  );
}
