import { taskDaysUntilDue, type TaskStatus } from "./tasks";

export type TaskDueTone = "bad" | "warn" | "muted";

/** Due-date label for a task row and whether it is a state worth coloring:
 * overdue → bad, due today or tomorrow → warn, anything else → muted. */
export function taskDueInfo(date: string | null, status: TaskStatus, now = new Date()): { label: string; tone: TaskDueTone } {
  if (!date) return { label: "Sin fecha", tone: "muted" };
  const due = new Date(`${date}T00:00:00`);
  if (status === "completed") return { label: due.toLocaleDateString("es-UY"), tone: "muted" };
  const days = taskDaysUntilDue(date, now) ?? 0;
  if (days < 0) return { label: `Vencida · ${due.toLocaleDateString("es-UY")}`, tone: "bad" };
  if (days === 0) return { label: "Vence hoy", tone: "warn" };
  if (days === 1) return { label: "Vence mañana", tone: "warn" };
  return { label: due.toLocaleDateString("es-UY"), tone: "muted" };
}
