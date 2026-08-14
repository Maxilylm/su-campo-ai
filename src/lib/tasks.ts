export type TaskStatus = "pending" | "completed";

export function taskDaysUntilDue(dueDate: string | null, now = new Date()): number | null {
  if (!dueDate) return null;
  const due = new Date(`${dueDate}T00:00:00`);
  if (!Number.isFinite(due.getTime())) return null;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return Math.round((due.getTime() - today.getTime()) / 86400000);
}

export function isTaskOverdue(dueDate: string | null, status: TaskStatus, now = new Date()): boolean {
  return status === "pending" && (taskDaysUntilDue(dueDate, now) ?? 0) < 0;
}
