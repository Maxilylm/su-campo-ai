"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CalendarDays, CheckSquare, ChevronRight, Syringe, Wheat } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useFarm } from "@/contexts/FarmContext";
import { fetchWithTimeout } from "@/lib/fetch";
import { adjustAgendaToLocalDay, buildAgenda, type AgendaInputs, type AgendaItem } from "@/lib/agenda";
import { useDataChangedRefresh } from "@/lib/use-data-changed-refresh";
import { isOfflineSnapshotFresh, offlineAgendaSnapshotKey, offlineEntitySnapshotKey, parseOfflineAgendaSnapshot, parseOfflineEntitySnapshot } from "@/lib/offline";

const PREVIEW_DAYS = 14;
const PREVIEW_LIMIT = 4;
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

function relativeDate(item: AgendaItem): string {
  if (item.daysFromNow < 0) return `Atrasado ${Math.abs(item.daysFromNow)}d`;
  if (item.daysFromNow === 0) return "Hoy";
  if (item.daysFromNow === 1) return "Mañana";
  return `En ${item.daysFromNow} días`;
}

function PreviewRow({ item }: { item: AgendaItem }) {
  const Icon = KIND_ICON[item.kind];
  return (
    <Link href={item.href} className="flex items-center gap-3 border-t border-border px-4 py-3 transition-colors first:border-t-0 hover:bg-accent/40">
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${KIND_COLOR[item.kind]}`}>
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{item.title}</span>
        <span className="block truncate text-xs text-muted-foreground">{item.detail}</span>
      </span>
      <span className={`shrink-0 text-xs ${item.daysFromNow < 0 ? "font-medium text-red-600 dark:text-red-400" : "text-muted-foreground"}`}>
        {relativeDate(item)}
      </span>
      {item.priority === "high" && <Badge variant="destructive" className="hidden shrink-0 sm:inline-flex">Alta</Badge>}
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}

function fromOfflineSnapshot(userId: string, days: number): { items: AgendaItem[]; savedAt: string } | null {
  let entity = null;
  let tasks = null;
  try {
    entity = parseOfflineEntitySnapshot(window.localStorage.getItem(offlineEntitySnapshotKey(userId)));
    tasks = parseOfflineAgendaSnapshot(window.localStorage.getItem(offlineAgendaSnapshotKey(userId)));
  } catch {
    return null;
  }

  if (entity && isOfflineSnapshotFresh(entity.savedAt)) {
    const items = buildAgenda({
      vaccinations: entity.vaccinations as AgendaInputs["vaccinations"],
      crops: entity.crops as AgendaInputs["crops"],
      tasks: entity.tasks as AgendaInputs["tasks"],
    }, Date.now(), days);
    return { items: adjustAgendaToLocalDay(items, localToday()), savedAt: entity.savedAt };
  }
  if (tasks && isOfflineSnapshotFresh(tasks.savedAt)) {
    const items = buildAgenda({
      vaccinations: [],
      crops: tasks.crops as AgendaInputs["crops"],
      tasks: tasks.tasks as AgendaInputs["tasks"],
    }, Date.now(), days);
    return { items: adjustAgendaToLocalDay(items, localToday()), savedAt: tasks.savedAt };
  }
  return null;
}

export function UpcomingAgendaCard() {
  const { userId, offlineMode, isOnline } = useFarm();
  const readOnly = offlineMode || !isOnline;
  const [items, setItems] = useState<AgendaItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    if (readOnly) {
      const cached = userId ? fromOfflineSnapshot(userId, PREVIEW_DAYS) : null;
      if (!cached) {
        setItems([]);
        setTotalCount(0);
        setError("Sin conexión: sincronizá la Agenda una vez para verla aquí.");
      } else {
        setItems(cached.items.slice(0, PREVIEW_LIMIT));
        setTotalCount(cached.items.length);
      }
      setLoaded(true);
      return;
    }

    setLoaded(false);
    try {
      const response = await fetchWithTimeout(`/api/agenda?days=${PREVIEW_DAYS}`, {}, 8000);
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "No se pudo cargar el próximo trabajo.");
      const nextItems = adjustAgendaToLocalDay(Array.isArray(payload?.items) ? payload.items : [], localToday());
      setItems(nextItems.slice(0, PREVIEW_LIMIT));
      setTotalCount(nextItems.length);
    } catch (cause) {
      setItems([]);
      setTotalCount(0);
      setError(cause instanceof Error ? cause.message : "No se pudo cargar el próximo trabajo.");
    } finally {
      setLoaded(true);
    }
  }, [readOnly, userId]);

  useEffect(() => { void load(); }, [load]);
  useDataChangedRefresh(load, !readOnly);

  return (
    <section className="mb-8 rounded-xl border border-border bg-card" aria-labelledby="upcoming-agenda-title">
      <div className="flex items-center justify-between gap-3 px-4 py-4 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><CalendarDays className="h-5 w-5" /></span>
          <div className="min-w-0">
            <h2 id="upcoming-agenda-title" className="font-medium">Próximo trabajo</h2>
            <p className="truncate text-xs text-muted-foreground">Tareas, vacunaciones y cosechas de los próximos 14 días</p>
          </div>
        </div>
        <Link href="/gestion/agenda" className="shrink-0 text-xs font-medium text-primary hover:underline">Ver agenda</Link>
      </div>
      {!loaded ? (
        <div className="border-t border-border px-4 py-5 text-sm text-muted-foreground">Cargando próximos trabajos…</div>
      ) : error ? (
        <div className="flex items-start gap-2 border-t border-border px-4 py-4 text-sm text-muted-foreground"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" /><span>{error} <Link href="/gestion/agenda" className="font-medium text-primary hover:underline">Abrir Agenda</Link></span></div>
      ) : items.length === 0 ? (
        <div className="border-t border-border px-4 py-5 text-sm text-muted-foreground">No hay trabajo programado en los próximos 14 días.</div>
      ) : (
        <div className="border-t border-border">
          {items.map((item) => <PreviewRow key={item.id} item={item} />)}
          {totalCount > items.length && <Link href="/gestion/agenda" className="block border-t border-border px-4 py-3 text-center text-xs font-medium text-primary hover:bg-accent/40">Ver {totalCount - items.length} más</Link>}
        </div>
      )}
    </section>
  );
}
