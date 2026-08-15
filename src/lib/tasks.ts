export type TaskStatus = "pending" | "completed";
export type TaskListFilter = "pending" | "completed" | "all" | "overdue";

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
  return status === "pending" && (taskDaysUntilDue(dueDate, now) ?? 0) < 0;
}

export function filterTasks<T extends TaskFilterRow>(tasks: T[], filter: TaskListFilter, now = new Date()): T[] {
  if (filter === "all") return tasks;
  if (filter === "overdue") return tasks.filter((task) => isTaskOverdue(task.due_date, task.status, now));
  return tasks.filter((task) => task.status === filter);
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

export function taskRelationLabel(task: TaskRelationInput): string | null {
  const labels = taskRelationLinks(task).map((relation) => relation.label);
  return labels.length > 0 ? labels.join(" · ") : null;
}

export function taskRelationMismatch(sectionId: string | null | undefined, relationSectionId: string | null | undefined): boolean {
  return Boolean(sectionId && relationSectionId && sectionId !== relationSectionId);
}
