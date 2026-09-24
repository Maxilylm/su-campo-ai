export interface Task {
  id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  priority: "low" | "medium" | "high";
  status: "pending" | "completed";
  section_id: string | null;
  cattle_id: string | null;
  crop_id: string | null;
  completed_at: string | null;
  sections?: { name: string } | null;
  cattle?: { category: string; count: number } | null;
  crops?: { crop_type: string } | null;
}

export interface TaskOptionRow { id: string; name?: string; category?: string; count?: number; crop_type?: string; section_id?: string | null }

export const TASK_PRIORITIES = [
  { value: "low", label: "Baja" },
  { value: "medium", label: "Media" },
  { value: "high", label: "Alta" },
];

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
}

export const EMPTY_TASK_FORM: TaskFormState = {
  editingTaskId: null, title: "", description: "", dueDate: "", priority: "medium", sectionId: "", cattleId: "", cropId: "",
};

export function taskFormSignature(form: TaskFormState): string {
  return JSON.stringify(form);
}
