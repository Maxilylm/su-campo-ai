"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { LoadingPage } from "@/components/LoadingPage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { groupAgendaByDay, type AgendaItem } from "@/lib/agenda";
import { CalendarDays, Syringe, Wheat, AlertTriangle, ChevronRight } from "lucide-react";
import { type LucideIcon } from "lucide-react";

const KIND_ICON: Record<AgendaItem["kind"], LucideIcon> = {
  vaccination: Syringe,
  harvest: Wheat,
};

const HORIZONS = [30, 60, 90] as const;

// Dates are day-precision "YYYY-MM-DD" strings; anchor at noon UTC so the
// rendered day never shifts in western-hemisphere timezones.
function dayLabel(date: string, daysFromNow: number): string {
  if (daysFromNow === 0) return "Hoy";
  if (daysFromNow === 1) return "Mañana";
  const label = new Date(`${date}T12:00:00Z`).toLocaleDateString("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function ItemRow({ item }: { item: AgendaItem }) {
  const Icon = KIND_ICON[item.kind];
  return (
    <Link
      href={item.href}
      className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 hover:bg-accent/50 transition-colors"
    >
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
          item.kind === "vaccination" ? "bg-sky-500/10 text-sky-600 dark:text-sky-400" : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
        }`}
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{item.title}</span>
        <span className="block truncate text-xs text-muted-foreground">{item.detail}</span>
      </span>
      {item.daysFromNow < 0 && (
        <Badge variant="destructive" className="shrink-0">
          {Math.abs(item.daysFromNow)}d atrasado
        </Badge>
      )}
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}

export default function AgendaPage() {
  const [items, setItems] = useState<AgendaItem[]>([]);
  const [horizon, setHorizon] = useState<(typeof HORIZONS)[number]>(60);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const loadAgenda = useCallback(async (days: number) => {
    setLoadError(false);
    try {
      const res = await fetch(`/api/agenda?days=${days}`);
      if (!res.ok) throw new Error("agenda request failed");
      const data = await res.json();
      setItems(data.items || []);
    } catch (e) {
      console.error("Load agenda error:", e);
      setLoadError(true);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    loadAgenda(horizon);
  }, [horizon, loadAgenda]);

  if (!loaded) return <LoadingPage />;

  const { overdue, days } = groupAgendaByDay(items);

  const header = (
    <PageHeader
      breadcrumbs={[{ label: "Gestion", href: "/gestion/inventario" }, { label: "Agenda" }]}
      title="Agenda"
      description="Plan de trabajo: vacunaciones y cosechas de los proximos dias"
    />
  );

  const horizonPicker = (
    <div className="flex gap-1">
      {HORIZONS.map((h) => (
        <Button
          key={h}
          variant={horizon === h ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setHorizon(h)}
        >
          {h} dias
        </Button>
      ))}
    </div>
  );

  if (loadError) {
    return (
      <div className="space-y-6">
        {header}
        <EmptyState
          icon={AlertTriangle}
          title="No se pudo cargar la agenda"
          description="Reintenta en unos segundos."
          actionLabel="Reintentar"
          onAction={() => loadAgenda(horizon)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}
      <div className="flex items-center justify-between gap-4">
        {horizonPicker}
        <p className="text-xs text-muted-foreground">
          {items.length} {items.length === 1 ? "tarea" : "tareas"}
        </p>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title="Agenda despejada"
          description="No hay vacunaciones ni cosechas programadas en este periodo. Carga la proxima fecha de vacunacion en Sanidad o la cosecha estimada en Agricultura."
        />
      ) : (
        <div className="space-y-6">
          {overdue.length > 0 && (
            <section className="space-y-2">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-red-600 dark:text-red-400">
                <AlertTriangle className="h-4 w-4" /> Atrasado
              </h2>
              <div className="space-y-2">
                {overdue.map((item) => (
                  <ItemRow key={item.id} item={item} />
                ))}
              </div>
            </section>
          )}

          {days.map((group) => (
            <section key={group.date} className="space-y-2">
              <h2 className="text-sm font-semibold">
                {dayLabel(group.date, group.items[0].daysFromNow)}
                <span className="ml-2 font-normal text-muted-foreground">
                  {group.items[0].daysFromNow > 1 ? `en ${group.items[0].daysFromNow} dias` : ""}
                </span>
              </h2>
              <div className="space-y-2">
                {group.items.map((item) => (
                  <ItemRow key={item.id} item={item} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
