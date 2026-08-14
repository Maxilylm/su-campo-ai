// Shared deadline normalization for alerts and the AI farm briefing.

export type DeadlineKind = "vaccination" | "harvest" | "task";

export interface DeadlineInput {
  id: string;
  kind: DeadlineKind;
  label: string;
  date: string | null;
  sectionName?: string | null;
  priority?: "low" | "medium" | "high";
}

export interface DeadlineAction {
  id: string;
  kind: DeadlineKind;
  label: string;
  date: string;
  daysUntil: number;
  detail: string;
}

const DAY = 86_400_000;
export const DEADLINE_HORIZON_DAYS = 30;

function daysUntil(date: string, now: number): number {
  return Math.round((new Date(date).getTime() - now) / DAY);
}

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
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
            : "Vence en " + d + "d (" + formatDate(date) + ")" + where;
      } else if (item.kind === "harvest") {
        detail = d < 0
          ? "Atrasada " + Math.abs(d) + "d" + where
          : d === 0
            ? "Cosechar hoy" + where
            : "En " + d + "d (" + formatDate(date) + ")" + where;
      } else {
        detail = d < 0
          ? "Vencida hace " + Math.abs(d) + "d" + where
          : d === 0
            ? "Vence hoy" + where
            : "Vence en " + d + "d (" + formatDate(date) + ")" + where;
      }
      return { id: item.id, kind: item.kind, label: item.label, date, daysUntil: d, detail };
    })
    .filter((item) => item.daysUntil <= horizonDays)
    .sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label));
}
