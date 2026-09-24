import { addCalendarDays, isValidDateOnly } from "./date";

export type TaskStatus = "pending" | "in_progress" | "completed";
/** "pending" means open work: Por hacer and En curso. */
export type TaskListFilter = "pending" | "completed" | "all" | "overdue";

/** Statuses that are still work to do. Server queries use this list so
 * alerts, agenda, plan, calendar and AI deadlines keep "En curso" tasks. */
export const OPEN_TASK_STATUSES = ["pending", "in_progress"] as const;
export const TASK_STATUSES: readonly TaskStatus[] = ["pending", "in_progress", "completed"];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  pending: "Por hacer",
  in_progress: "En curso",
  completed: "Hecha",
};

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === "string" && (TASK_STATUSES as readonly string[]).includes(value);
}

export function isTaskOpen(status: string): boolean {
  return status !== "completed";
}

/** The statuses a person can pick. Without migration 053 the database only
 * accepts pending/completed, so "En curso" is not offered. */
export function taskStatusOptions(inProgressAvailable: boolean): TaskStatus[] {
  return inProgressAvailable ? [...TASK_STATUSES] : ["pending", "completed"];
}

/** Local mirror of what PUT /api/tasks stores with a status change. */
export function taskStatusPatch(status: TaskStatus, now = new Date()): { status: TaskStatus; completed_at: string | null } {
  return { status, completed_at: status === "completed" ? now.toISOString() : null };
}

/** The list checkbox: done → back to "Por hacer", anything open → done. */
export function toggledTaskStatus(status: TaskStatus): TaskStatus {
  return status === "completed" ? "pending" : "completed";
}

export interface TaskFilterRow {
  due_date: string | null;
  status: TaskStatus;
}

export interface TaskRelationInput {
  section_id?: string | null;
  cattle_id?: string | null;
  crop_id?: string | null;
  sections?: { name?: string } | null;
  cattle?: { category?: string; count?: number } | null;
  crops?: { crop_type?: string } | null;
}

export interface TaskRelationLink {
  label: string;
  href: string | null;
}

export function taskDaysUntilDue(dueDate: string | null, now = new Date()): number | null {
  if (!dueDate) return null;
  const due = new Date(`${dueDate}T00:00:00`);
  if (!Number.isFinite(due.getTime())) return null;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return Math.round((due.getTime() - today.getTime()) / 86400000);
}

export function isTaskOverdue(dueDate: string | null, status: TaskStatus, now = new Date()): boolean {
  return isTaskOpen(status) && (taskDaysUntilDue(dueDate, now) ?? 0) < 0;
}

export function filterTasks<T extends TaskFilterRow>(tasks: T[], filter: TaskListFilter, now = new Date()): T[] {
  if (filter === "all") return tasks;
  if (filter === "overdue") return tasks.filter((task) => isTaskOverdue(task.due_date, task.status, now));
  if (filter === "pending") return tasks.filter((task) => isTaskOpen(task.status));
  return tasks.filter((task) => task.status === filter);
}

/** "Asignadas a mí": null userId (signed out, offline without id) shows none. */
export function filterTasksByAssignee<T extends { assigned_to?: string | null }>(tasks: T[], userId: string | null): T[] {
  return userId ? tasks.filter((task) => task.assigned_to === userId) : [];
}

export interface TaskBoardColumn<T> {
  status: TaskStatus;
  label: string;
  tasks: T[];
  /** All tasks in the column; the done column shows only the latest ones. */
  total: number;
}

export const TASK_BOARD_DONE_LIMIT = 20;

/** Kanban columns. Without "En curso" (053 not applied) any such row falls
 * back into "Por hacer". The done column keeps the most recently completed. */
export function taskBoardColumns<T extends { status: TaskStatus; completed_at?: string | null }>(
  tasks: T[],
  { includeInProgress, doneLimit = TASK_BOARD_DONE_LIMIT }: { includeInProgress: boolean; doneLimit?: number },
): TaskBoardColumn<T>[] {
  const pending: T[] = [];
  const inProgress: T[] = [];
  const completed: T[] = [];
  for (const task of tasks) {
    if (task.status === "completed") completed.push(task);
    else if (task.status === "in_progress" && includeInProgress) inProgress.push(task);
    else pending.push(task);
  }
  const doneTime = (task: T) => {
    const time = task.completed_at ? Date.parse(task.completed_at) : NaN;
    return Number.isFinite(time) ? time : -Infinity;
  };
  const latestDone = [...completed].sort((a, b) => doneTime(b) - doneTime(a)).slice(0, doneLimit);
  const columns: TaskBoardColumn<T>[] = [
    { status: "pending", label: TASK_STATUS_LABELS.pending, tasks: pending, total: pending.length },
  ];
  if (includeInProgress) columns.push({ status: "in_progress", label: TASK_STATUS_LABELS.in_progress, tasks: inProgress, total: inProgress.length });
  columns.push({ status: "completed", label: TASK_STATUS_LABELS.completed, tasks: latestDone, total: completed.length });
  return columns;
}

/** One letter for an assignee badge: first letter of the email's local part. */
export function assigneeInitial(email: string | null | undefined): string {
  const letter = email?.trim().match(/[\p{L}\p{N}]/u)?.[0];
  return letter ? letter.toLocaleUpperCase("es-UY") : "?";
}

export function taskRelationLinks(task: TaskRelationInput): TaskRelationLink[] {
  const links: TaskRelationLink[] = [];
  if (task.sections?.name) {
    links.push({
      label: `Sección: ${task.sections.name}`,
      href: task.section_id ? `/produccion/hacienda?sectionId=${encodeURIComponent(task.section_id)}` : null,
    });
  }
  if (task.cattle?.category) {
    links.push({
      label: `Hacienda: ${task.cattle.category}${task.cattle.count == null ? "" : ` (${task.cattle.count})`}`,
      href: task.cattle_id ? `/produccion/hacienda?cattleId=${encodeURIComponent(task.cattle_id)}` : null,
    });
  }
  if (task.crops?.crop_type) {
    links.push({
      label: `Cultivo: ${task.crops.crop_type}`,
      href: task.crop_id ? `/produccion/agricultura?cropId=${encodeURIComponent(task.crop_id)}` : null,
    });
  }
  return links;
}

export function taskRelationMismatch(sectionId: string | null | undefined, relationSectionId: string | null | undefined): boolean {
  return Boolean(sectionId && relationSectionId && sectionId !== relationSectionId);
}

/** "Postergar": one day after today for an overdue task (the button says
 * "Mañana"), otherwise one day after its due date. Counting from the old date
 * moved a task 13 days late to a date still 12 days in the past. */
export function snoozeDueDate(dueDate: string, today: string): string | undefined {
  const due = dueDate.slice(0, 10);
  if (!isValidDateOnly(due)) return undefined;
  return addCalendarDays(due < today ? today : due, 1);
}
