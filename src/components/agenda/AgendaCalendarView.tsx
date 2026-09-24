"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AgendaCalendar } from "./AgendaCalendar";
import type { AgendaItem } from "@/lib/agenda";
import { dayHeading, daysBetween, monthGridRange, monthOf, sameMonth, type MonthRef } from "@/lib/calendar-grid";

const DESKTOP_QUERY = "(min-width: 1024px)";

function relativeDay(date: string, today: string): string {
  const days = daysBetween(today, date);
  if (days === 0) return "Hoy";
  if (days === 1) return "Mañana";
  if (days === -1) return "Ayer";
  return days > 0 ? `En ${days} días` : `Hace ${Math.abs(days)} días`;
}

function pendingSummary(date: string, today: string, count: number): string {
  return `${relativeDay(date, today)} · ${count === 0 ? "sin pendientes" : `${count} ${count === 1 ? "pendiente" : "pendientes"}`}`;
}

function DayItems({ items, renderRow }: { items: AgendaItem[]; renderRow: (item: AgendaItem) => ReactNode }) {
  if (items.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
        Nada programado para este día. <Link href="/gestion/tareas" className="font-medium text-primary underline-offset-2 hover:underline">Cargá una tarea</Link>
      </p>
    );
  }
  return <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">{items.map(renderRow)}</div>;
}

/**
 * Calendario: month grid plus the chosen day's full list — a side panel on
 * desktop (lg+), a bottom sheet on smaller screens. Rows are the same
 * AgendaItemRow as the list, so Hecha / +1 día behave identically.
 */
export function AgendaCalendarView({
  month,
  onMonthChange,
  today,
  items,
  renderRow,
  overdueBeforeWindow,
  onShowList,
  busy,
}: {
  month: MonthRef;
  onMonthChange: (month: MonthRef) => void;
  today: string;
  items: AgendaItem[];
  renderRow: (item: AgendaItem) => ReactNode;
  overdueBeforeWindow: number;
  onShowList: () => void;
  busy: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const range = monthGridRange(month);
  const selectedInView = selected && selected >= range.start && selected <= range.end ? selected : null;
  // Without a choice, the panel shows today in the current month, else the 1st.
  const panelDate = selectedInView ?? (sameMonth(monthOf(today), month) ? today : `${month.year}-${String(month.month).padStart(2, "0")}-01`);
  const dayItems = items.filter((item) => item.date === panelDate);

  function openDay(date: string) {
    setSelected(date);
    let desktop = false;
    try {
      desktop = window.matchMedia(DESKTOP_QUERY).matches;
    } catch {
      desktop = false;
    }
    if (!desktop) setSheetOpen(true);
  }

  return (
    <div className="space-y-4">
      {overdueBeforeWindow > 0 && (
        <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-bad-line bg-bad-soft px-3 py-2 text-sm text-bad">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            <span className="figure font-semibold">{overdueBeforeWindow}</span> {overdueBeforeWindow === 1 ? "pendiente atrasado" : "pendientes atrasados"} con fecha anterior a este calendario.
          </span>
          <Button variant="link" size="sm" className="h-auto p-0 text-bad" onClick={onShowList}>Verlos en la lista</Button>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <AgendaCalendar
          month={month}
          onMonthChange={onMonthChange}
          today={today}
          items={items}
          selectedDate={selectedInView}
          onOpenDay={openDay}
          onToday={() => { setSelected(today); onMonthChange(monthOf(today)); }}
          busy={busy}
        />

        <aside aria-labelledby="agenda-day-title" className="hidden space-y-3 lg:block">
          <div className="lg:sticky lg:top-4 space-y-3">
            <div>
              <h2 id="agenda-day-title" className="text-base font-semibold">{dayHeading(panelDate)}</h2>
              <p className="text-sm text-muted-foreground">{pendingSummary(panelDate, today, dayItems.length)}</p>
            </div>
            <DayItems items={dayItems} renderRow={renderRow} />
          </div>
        </aside>
      </div>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-lg pb-[max(1rem,env(safe-area-inset-bottom))] lg:hidden">
          <SheetHeader>
            <SheetTitle>{dayHeading(panelDate)}</SheetTitle>
            <SheetDescription>{pendingSummary(panelDate, today, dayItems.length)}</SheetDescription>
          </SheetHeader>
          <div className="px-4">
            <DayItems items={dayItems} renderRow={renderRow} />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
