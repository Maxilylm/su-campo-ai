// Month grid for the agenda calendar. Works only on YYYY-MM-DD strings with
// UTC arithmetic, so a daylight-saving switch in the viewer's time zone can
// never skip or repeat a day. Weeks start on Monday, as in Uruguay.

export interface MonthRef {
  year: number;
  /** 1–12 */
  month: number;
}

export interface CalendarDay<T> {
  date: string;
  day: number;
  /** 0 = lunes … 6 = domingo */
  weekday: number;
  inMonth: boolean;
  today: boolean;
  past: boolean;
  weekend: boolean;
  items: T[];
}

export interface MonthGrid<T> {
  start: string;
  end: string;
  weeks: CalendarDay<T>[][];
}

// es-UY: Uruguay writes "setiembre", which Intl's es locales spell "septiembre".
export const MONTH_NAMES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"] as const;
export const WEEKDAY_NAMES = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"] as const;
export const WEEKDAY_SHORT = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"] as const;

const DAY_MS = 86_400_000;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function toUTC(date: string): number {
  const [year, month, day] = date.slice(0, 10).split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function fromUTC(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function addDays(date: string, days: number): string {
  return fromUTC(toUTC(date) + days * DAY_MS);
}

/** Whole calendar days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((toUTC(to) - toUTC(from)) / DAY_MS);
}

/** 0 = lunes … 6 = domingo. */
export function weekdayIndex(date: string): number {
  return (new Date(toUTC(date)).getUTCDay() + 6) % 7;
}

export function monthOf(date: string): MonthRef {
  const [year, month] = date.slice(0, 10).split("-").map(Number);
  return { year, month };
}

export function shiftMonth(ref: MonthRef, delta: number): MonthRef {
  const index = ref.year * 12 + (ref.month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export function sameMonth(a: MonthRef, b: MonthRef): boolean {
  return a.year === b.year && a.month === b.month;
}

export function monthTitle(ref: MonthRef): string {
  return `${capitalize(MONTH_NAMES[ref.month - 1])} ${ref.year}`;
}

function daysInMonth(ref: MonthRef): number {
  return new Date(Date.UTC(ref.year, ref.month, 0)).getUTCDate();
}

function firstOfMonth(ref: MonthRef): string {
  return `${ref.year}-${pad(ref.month)}-01`;
}

/** "Jueves 24 de setiembre" */
export function dayHeading(date: string): string {
  const [, month, day] = date.slice(0, 10).split("-").map(Number);
  return `${capitalize(WEEKDAY_NAMES[weekdayIndex(date)])} ${day} de ${MONTH_NAMES[month - 1]}`;
}

/** "Jueves 24 de setiembre, hoy, 2 pendientes, 1 atrasado" */
export function dayAriaLabel(date: string, pending: number, options: { today?: boolean; overdue?: number } = {}): string {
  const parts = [dayHeading(date)];
  if (options.today) parts.push("hoy");
  parts.push(pending === 0 ? "sin pendientes" : `${pending} ${pending === 1 ? "pendiente" : "pendientes"}`);
  if (options.overdue) parts.push(`${options.overdue} ${options.overdue === 1 ? "atrasado" : "atrasados"}`);
  return parts.join(", ");
}

/** Monday on or before the 1st through Sunday on or after the last day. */
export function monthGridRange(ref: MonthRef): { start: string; end: string } {
  const first = firstOfMonth(ref);
  const last = addDays(first, daysInMonth(ref) - 1);
  return { start: addDays(first, -weekdayIndex(first)), end: addDays(last, 6 - weekdayIndex(last)) };
}

export function buildMonthGrid<T extends { date: string }>(ref: MonthRef, today: string, items: readonly T[]): MonthGrid<T> {
  const { start, end } = monthGridRange(ref);
  const buckets = new Map<string, T[]>();
  for (const entry of items) {
    const key = entry.date.slice(0, 10);
    if (key < start || key > end) continue;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(entry);
    else buckets.set(key, [entry]);
  }

  const weeks: CalendarDay<T>[][] = [];
  const total = daysBetween(start, end) + 1;
  for (let offset = 0; offset < total; offset += 1) {
    const date = addDays(start, offset);
    const weekday = offset % 7;
    const [year, month, day] = date.split("-").map(Number);
    if (weekday === 0) weeks.push([]);
    weeks[weeks.length - 1].push({
      date,
      day,
      weekday,
      inMonth: year === ref.year && month === ref.month,
      today: date === today,
      past: date < today,
      weekend: weekday >= 5,
      items: buckets.get(date) ?? [],
    });
  }
  return { start, end, weeks };
}

export type CalendarFocusKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown" | "Home" | "End" | "PageUp" | "PageDown";

/** Where keyboard focus goes from `date`, or null for keys the grid ignores. */
export function moveCalendarFocus(date: string, key: string): string | null {
  switch (key) {
    case "ArrowLeft": return addDays(date, -1);
    case "ArrowRight": return addDays(date, 1);
    case "ArrowUp": return addDays(date, -7);
    case "ArrowDown": return addDays(date, 7);
    case "Home": return addDays(date, -weekdayIndex(date));
    case "End": return addDays(date, 6 - weekdayIndex(date));
    case "PageUp":
    case "PageDown": {
      const target = shiftMonth(monthOf(date), key === "PageUp" ? -1 : 1);
      const day = Math.min(Number(date.slice(8, 10)), daysInMonth(target));
      return `${target.year}-${pad(target.month)}-${pad(day)}`;
    }
    default: return null;
  }
}
