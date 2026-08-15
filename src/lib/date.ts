// Date helpers for HTML date inputs. Avoid Date#toISOString() for calendar
// dates: it converts to UTC and can move a local date to the previous/next day.

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function dateInputValue(date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
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
