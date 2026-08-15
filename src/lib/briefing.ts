// Shared deadline normalization for alerts and the AI farm briefing.

export type DeadlineKind = "vaccination" | "harvest" | "task";

export interface DeadlineInput {
  id: string;
  kind: DeadlineKind;
  label: string;
  date: string | null;
  sectionName?: string | null;
  sectionId?: string | null;
  cattleId?: string | null;
  cropId?: string | null;
  priority?: "low" | "medium" | "high";
}

export interface DeadlineAction {
  id: string;
  kind: DeadlineKind;
  label: string;
  date: string;
  daysUntil: number;
  detail: string;
  sectionId?: string;
  cattleId?: string;
  cropId?: string;
}

const DAY = 86_400_000;
export const DEADLINE_HORIZON_DAYS = 30;

function calendarDateParts(value: string): [number, number, number] | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const normalized = new Date(timestamp);
  if (
    normalized.getUTCFullYear() !== year
    || normalized.getUTCMonth() !== month - 1
    || normalized.getUTCDate() !== day
  ) return null;
  return [year, month, day];
}

function daysUntil(date: string, now: number): number {
  const parts = calendarDateParts(date);
  if (!parts) return Number.NaN;
  const [year, month, day] = parts;
  const today = new Date(now);
  const todayTimestamp = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((Date.UTC(year, month - 1, day) - todayTimestamp) / DAY);
}

export function formatCalendarDate(date: string): string {
  const parts = calendarDateParts(date);
  if (!parts) return "";
  const [, month, day] = parts;
  return String(day).padStart(2, "0") + "/" + String(month).padStart(2, "0");
}

export function buildDeadlineActions(
  input: DeadlineInput[],
  now: number,
  horizonDays = DEADLINE_HORIZON_DAYS
): DeadlineAction[] {
  return input
    .filter((item) => item.date)
    .map((item) => {
      const date = item.date as string;
      const d = daysUntil(date, now);
      const where = item.sectionName ? " en " + item.sectionName : "";
      let detail: string;
      if (item.kind === "vaccination") {
        detail = d < 0
          ? "Vencida hace " + Math.abs(d) + "d" + where
          : d === 0
            ? "Vence hoy" + where
            : "Vence en " + d + "d (" + formatCalendarDate(date) + ")" + where;
      } else if (item.kind === "harvest") {
        detail = d < 0
          ? "Atrasada " + Math.abs(d) + "d" + where
          : d === 0
            ? "Cosechar hoy" + where
            : "En " + d + "d (" + formatCalendarDate(date) + ")" + where;
      } else {
        detail = d < 0
          ? "Vencida hace " + Math.abs(d) + "d" + where
          : d === 0
            ? "Vence hoy" + where
            : "Vence en " + d + "d (" + formatCalendarDate(date) + ")" + where;
      }
      return {
        id: item.id,
        kind: item.kind,
        label: item.label,
        date,
        daysUntil: d,
        detail,
        ...(item.sectionId ? { sectionId: item.sectionId } : {}),
        ...(item.cattleId ? { cattleId: item.cattleId } : {}),
        ...(item.cropId ? { cropId: item.cropId } : {}),
      };
    })
    .filter((item) => item.daysUntil <= horizonDays)
    .sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label));
}
