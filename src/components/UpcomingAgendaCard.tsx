"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CalendarDays } from "lucide-react";
import { useFarm } from "@/contexts/FarmContext";
import { fetchWithTimeout } from "@/lib/fetch";
import { adjustAgendaToLocalDay, buildAgenda, type AgendaInputs, type AgendaItem } from "@/lib/agenda";
import { useDataChangedRefresh } from "@/lib/use-data-changed-refresh";
import { useOfflineSnapshotRefresh } from "@/lib/use-offline-snapshot-refresh";
import { isOfflineSnapshotFresh, offlineAgendaSnapshotKey, offlineEntitySnapshotKey, parseOfflineAgendaSnapshot, parseOfflineEntitySnapshot } from "@/lib/offline";
import { AgendaItemRow } from "@/components/AgendaItemRow";

const PREVIEW_DAYS = 14;
const PREVIEW_LIMIT = 4;

function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function fromOfflineSnapshot(userId: string, days: number): { items: AgendaItem[]; savedAt: string; truncated: boolean } | null {
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
    return {
      items: adjustAgendaToLocalDay(items, localToday()),
      savedAt: entity.savedAt,
      truncated: entity.vaccinationsTruncated === true || entity.cropsTruncated === true || entity.tasksTruncated === true,
    };
  }
  if (tasks && isOfflineSnapshotFresh(tasks.savedAt)) {
    const items = buildAgenda({
      vaccinations: [],
      crops: tasks.crops as AgendaInputs["crops"],
      tasks: tasks.tasks as AgendaInputs["tasks"],
    }, Date.now(), days);
    return { items: adjustAgendaToLocalDay(items, localToday()), savedAt: tasks.savedAt, truncated: tasks.tasksTruncated === true };
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
  const [agendaTruncated, setAgendaTruncated] = useState(false);
  const requestId = useRef(0);
  const requestRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    const currentRequest = ++requestId.current;
    requestRef.current?.abort();
    setError(null);
    setAgendaTruncated(false);
    if (readOnly) {
      const cached = userId ? fromOfflineSnapshot(userId, PREVIEW_DAYS) : null;
      if (!cached) {
        setItems([]);
        setTotalCount(0);
        setError("Sin conexión: sincronizá la Agenda una vez para verla aquí.");
      } else {
        setItems(cached.items.slice(0, PREVIEW_LIMIT));
        setTotalCount(cached.items.length);
        setAgendaTruncated(cached.truncated);
      }
      setLoaded(true);
      return;
    }

    setLoaded(false);
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      const response = await fetchWithTimeout(`/api/agenda?days=${PREVIEW_DAYS}`, { signal: controller.signal }, 8000);
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "No se pudo cargar el próximo trabajo.");
      if (controller.signal.aborted || currentRequest !== requestId.current) return;
      const nextItems = adjustAgendaToLocalDay(Array.isArray(payload?.items) ? payload.items : [], localToday());
      setItems(nextItems.slice(0, PREVIEW_LIMIT));
      setTotalCount(nextItems.length);
      setAgendaTruncated(Array.isArray(payload?.truncatedSources)
        ? payload.truncatedSources.length > 0
        : payload?.vaccinationsTruncated === true || payload?.cropsTruncated === true || payload?.tasksTruncated === true);
    } catch (cause) {
      if (controller.signal.aborted || currentRequest !== requestId.current) return;
      setItems([]);
      setTotalCount(0);
      setError(cause instanceof Error ? cause.message : "No se pudo cargar el próximo trabajo.");
    } finally {
      if (currentRequest === requestId.current) setLoaded(true);
      if (requestRef.current === controller) requestRef.current = null;
    }
  }, [readOnly, userId]);

  useEffect(() => {
    void load();
    return () => {
      requestId.current += 1;
      requestRef.current?.abort();
    };
  }, [load]);
  useDataChangedRefresh(load, !readOnly);
  useOfflineSnapshotRefresh(load, userId, readOnly);

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
        <div className="border-t border-border px-4 py-5 text-sm text-muted-foreground">{agendaTruncated && <span className="mb-2 block">La vista está limitada para mantenerla rápida. <Link href="/gestion/agenda" className="font-medium text-primary hover:underline">Ver la Agenda completa</Link>.</span>}No hay trabajo programado en los próximos 14 días.</div>
      ) : (
        <div className="border-t border-border">
          {agendaTruncated && <div className="border-b border-border px-4 py-3 text-sm text-muted-foreground">La vista está limitada para mantenerla rápida. <Link href="/gestion/agenda" className="font-medium text-primary hover:underline">Ver la Agenda completa</Link>.</div>}
          {items.map((item) => <AgendaItemRow key={item.id} item={item} compact />)}
          {totalCount > items.length && <Link href="/gestion/agenda" className="block border-t border-border px-4 py-3 text-center text-xs font-medium text-primary hover:bg-accent/40">Ver {totalCount - items.length} más</Link>}
        </div>
      )}
    </section>
  );
}
