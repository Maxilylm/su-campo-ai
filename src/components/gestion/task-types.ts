import type { TaskStatus } from "@/lib/tasks";

export interface Task {
  id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  priority: "low" | "medium" | "high";
  status: TaskStatus;
  section_id: string | null;
  cattle_id: string | null;
  crop_id: string | null;
  completed_at: string | null;
  /** Migration 053; absent before it is applied. */
  assigned_to?: string | null;
  created_at?: string;
  updated_at?: string;
  sections?: { name: string } | null;
  cattle?: { category: string; count: number } | null;
  crops?: { crop_type: string } | null;
}

export interface TaskOptionRow { id: string; name?: string; category?: string; count?: number; crop_type?: string; section_id?: string | null }

/** A farm member who can be assigned (from /api/members). */
export interface TaskMember { user_id: string; email: string | null; role: "owner" | "editor" | "viewer" }

export const TASK_PRIORITIES = [
  { value: "low", label: "Baja" },
  { value: "medium", label: "Media" },
  { value: "high", label: "Alta" },
];

export function taskPriorityLabel(priority: string): string {
  return TASK_PRIORITIES.find((item) => item.value === priority)?.label ?? priority;
}

/** "juan@campo.uy", "Ex miembro" for someone no longer in the farm. */
export function taskAssigneeLabel(assignedTo: string | null | undefined, members: TaskMember[]): string | null {
  if (!assignedTo) return null;
  const member = members.find((item) => item.user_id === assignedTo);
  if (member) return member.email || "Miembro sin email";
  return members.length > 0 ? "Ex miembro" : "Miembro del campo";
}

/** The task sheet's fields — also its unsaved-changes signature. */
export interface TaskFormState {
  editingTaskId: string | null;
  title: string;
  description: string;
  dueDate: string;
  priority: string;
  sectionId: string;
  cattleId: string;
  cropId: string;
  assignedTo: string;
}

export const EMPTY_TASK_FORM: TaskFormState = {
  editingTaskId: null, title: "", description: "", dueDate: "", priority: "medium", sectionId: "", cattleId: "", cropId: "", assignedTo: "",
};

export function taskFormSignature(form: TaskFormState): string {
  return JSON.stringify(form);
}
