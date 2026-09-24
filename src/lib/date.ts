// Date helpers for HTML date inputs. Avoid Date#toISOString() for calendar
// dates: it converts to UTC and can move a local date to the previous/next day.

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function dateInputValue(date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Farm-local calendar day. The farms are in Uruguay/Argentina (UTC-3); the
 * server runs in UTC, which is already "tomorrow" after 21:00 local. */
export function farmLocalToday(now: number, timeZone = "America/Montevideo"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
}

/** Noon UTC of the farm-local day. Helpers that read the calendar day with
 * getUTC* (briefing's daysUntil) then see the farm's day at any hour. */
export function farmDayAnchor(now: number, timeZone = "America/Montevideo"): number {
  return Date.parse(`${farmLocalToday(now, timeZone)}T12:00:00Z`);
}

/** Shift a calendar date without letting UTC conversion change the day. */
export function addCalendarDays(value: string, days: number): string | undefined {
  if (!isValidDateOnly(value) || !Number.isInteger(days)) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  return dateInputValue(date);
}

export function dateInputToIso(value: string): string | undefined {
  if (!isValidDateOnly(value)) return undefined;

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);

  return date.toISOString();
}

/** Past due by calendar day: a due date equal to `today` is "vence hoy", not
 * overdue. Reads the stored calendar day (first 10 chars) — due dates are saved
 * as local midnight or UTC midnight, and comparing instants flagged them
 * overdue at 00:00 (or at 21:00 the evening before, in Uruguay). */
export function isPastCalendarDate(value: string | null | undefined, today: string): boolean {
  return Boolean(value) && value!.slice(0, 10) < today;
}

/** Accepts a date input or an ISO timestamp while rejecting impossible days. */
export function isValidDateValue(value: unknown): value is string {
  if (typeof value !== "string" || !value) return false;
  const datePart = /^(\d{4}-\d{2}-\d{2})(?:$|T)/.exec(value)?.[1];
  if (!datePart || !isValidDateOnly(datePart)) return false;
  return value.length === 10 || Number.isFinite(Date.parse(value));
}

export function isValidDateOnly(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}
