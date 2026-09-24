"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AGENDA_KIND_ICON } from "@/components/AgendaItemRow";
import { agendaDueTone, shortAgendaLabel, type AgendaItem } from "@/lib/agenda";
import {
  buildMonthGrid,
  dayAriaLabel,
  monthOf,
  monthTitle,
  moveCalendarFocus,
  sameMonth,
  shiftMonth,
  WEEKDAY_NAMES,
  WEEKDAY_SHORT,
  type CalendarDay,
  type MonthRef,
} from "@/lib/calendar-grid";
import { toneTint, type Tone } from "@/lib/status-styles";
import { cn } from "@/lib/utils";

const MAX_CHIPS = 3;

function chipClass(tone: Tone): string {
  return tone === "neutral" ? "bg-muted text-foreground" : toneTint(tone);
}

function dotClass(tone: Tone): string {
  if (tone === "bad") return "bg-bad";
  if (tone === "warn") return "bg-warn";
  return "bg-muted-foreground";
}

/**
 * Month grid of agenda items. Weeks start on Monday. Arrow keys move between
 * days (Home/End: week edges, PageUp/PageDown: month), Enter opens the day.
 * Phones get tone dots instead of chips: seven readable columns at 375 px.
 */
export function AgendaCalendar({
  month,
  onMonthChange,
  today,
  items,
  selectedDate,
  onOpenDay,
  onToday,
  busy = false,
}: {
  month: MonthRef;
  onMonthChange: (month: MonthRef) => void;
  today: string;
  items: AgendaItem[];
  selectedDate: string | null;
  onOpenDay: (date: string) => void;
  /** Back to the current month with today selected (without opening it). */
  onToday: () => void;
  busy?: boolean;
}) {
  const titleId = useId();
  const grid = useMemo(() => buildMonthGrid(month, today, items), [month, today, items]);
  const [focusDate, setFocusDate] = useState<string | null>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const moveFocusPending = useRef(false);

  const inGrid = (date: string | null): date is string => Boolean(date) && date! >= grid.start && date! <= grid.end;
  // The one day reachable with Tab (roving tabindex).
  const tabDate = inGrid(focusDate)
    ? focusDate
    : inGrid(selectedDate)
      ? selectedDate
      : sameMonth(monthOf(today), month)
        ? today
        : `${month.year}-${String(month.month).padStart(2, "0")}-01`;

  useEffect(() => {
    if (!moveFocusPending.current) return;
    moveFocusPending.current = false;
    buttons.current.get(tabDate)?.focus();
  }, [tabDate]);

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, date: string) {
    const next = moveCalendarFocus(date, event.key);
    if (!next) return;
    event.preventDefault();
    moveFocusPending.current = true;
    setFocusDate(next);
    if (next < grid.start || next > grid.end || event.key === "PageUp" || event.key === "PageDown") onMonthChange(monthOf(next));
  }

  const isCurrentMonth = sameMonth(monthOf(today), month);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 id={titleId} className="text-base font-semibold" aria-live="polite">{monthTitle(month)}</h2>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" aria-label="Mes anterior" onClick={() => onMonthChange(shiftMonth(month, -1))}><ChevronLeft aria-hidden="true" /></Button>
          <Button variant="outline" size="sm" title={isCurrentMonth ? undefined : "Volver al mes actual"} onClick={() => { setFocusDate(today); onToday(); }}>Hoy</Button>
          <Button variant="outline" size="icon" aria-label="Mes siguiente" onClick={() => onMonthChange(shiftMonth(month, 1))}><ChevronRight aria-hidden="true" /></Button>
        </div>
      </div>

      <div role="grid" aria-labelledby={titleId} aria-busy={busy} className="overflow-hidden rounded-lg border border-border bg-card">
        <div role="row" className="grid grid-cols-7 border-b border-border">
          {WEEKDAY_SHORT.map((label, index) => (
            <div key={label} role="columnheader" aria-label={WEEKDAY_NAMES[index]} className={cn("px-1 py-2 text-center text-xs font-medium text-muted-foreground sm:px-2 sm:text-left", index >= 5 && "bg-muted/50")}>
              <span aria-hidden="true">{label}</span>
            </div>
          ))}
        </div>
        {grid.weeks.map((week) => (
          <div key={week[0].date} role="row" className="grid grid-cols-7 divide-x divide-border border-b border-border last:border-b-0">
            {week.map((day) => (
              <DayCell
                key={day.date}
                day={day}
                selected={day.date === selectedDate}
                tabbable={day.date === tabDate}
                onOpen={() => { setFocusDate(day.date); onOpenDay(day.date); }}
                onKeyDown={(event) => onKeyDown(event, day.date)}
                buttonRef={(node) => {
                  if (node) buttons.current.set(day.date, node);
                  else buttons.current.delete(day.date);
                }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function DayCell({ day, selected, tabbable, onOpen, onKeyDown, buttonRef }: {
  day: CalendarDay<AgendaItem>;
  selected: boolean;
  tabbable: boolean;
  onOpen: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  buttonRef: (node: HTMLButtonElement | null) => void;
}) {
  const overdue = day.items.filter((item) => item.daysFromNow < 0).length;
  const chips = day.items.slice(0, MAX_CHIPS);
  const more = day.items.length - chips.length;
  return (
    <div role="gridcell" aria-selected={selected} className={cn("min-w-0", day.weekend && "bg-muted/50")}>
      <button
        type="button"
        ref={buttonRef}
        tabIndex={tabbable ? 0 : -1}
        aria-label={dayAriaLabel(day.date, day.items.length, { today: day.today, overdue })}
        aria-current={day.today ? "date" : undefined}
        onClick={onOpen}
        onKeyDown={onKeyDown}
        className={cn(
          "flex h-14 w-full flex-col items-center gap-1 p-1 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50 sm:h-auto sm:min-h-28 sm:items-stretch sm:p-1.5",
          selected && "bg-accent",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "figure inline-flex h-6 min-w-6 items-center justify-center self-center rounded-full px-1 text-sm sm:self-start",
            day.today ? "bg-primary font-semibold text-primary-foreground" : day.inMonth ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {day.day}
        </span>

        {/* Phones: one dot per item (up to three), colored only by state. */}
        {day.items.length > 0 && (
          <span aria-hidden="true" className="flex items-center gap-0.5 sm:hidden">
            {chips.map((item) => <span key={item.id} className={cn("h-1.5 w-1.5 rounded-full", dotClass(agendaDueTone(item)))} />)}
            {more > 0 && <span className="figure text-[10px] leading-none text-muted-foreground">+{more}</span>}
          </span>
        )}

        {/* Tablet and up: compact chips with the kind icon and a short label. */}
        {day.items.length > 0 && (
          <span aria-hidden="true" className="hidden min-w-0 flex-col gap-0.5 sm:flex">
            {chips.map((item) => {
              const Icon = AGENDA_KIND_ICON[item.kind];
              return (
                <span key={item.id} className={cn("flex min-w-0 items-center gap-1 rounded px-1 py-0.5 text-xs", chipClass(agendaDueTone(item)))}>
                  <Icon className="h-3 w-3 shrink-0" />
                  <span className="truncate">{shortAgendaLabel(item.title)}</span>
                </span>
              );
            })}
            {more > 0 && <span className="px-1 text-xs text-muted-foreground">+<span className="figure">{more}</span> más</span>}
          </span>
        )}
      </button>
    </div>
  );
}
