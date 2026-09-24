"use client";

import { Badge } from "@/components/ui/badge";
import { type TaskDueTone } from "@/lib/task-due";
import { assigneeInitial, TASK_STATUS_LABELS, type TaskStatus } from "@/lib/tasks";
import { cn } from "@/lib/utils";
import { taskPriorityLabel, type Task } from "./task-types";

export const DUE_TEXT: Record<TaskDueTone, string> = { bad: "text-bad", warn: "text-warn", muted: "text-muted-foreground" };

const STATUS_VARIANT: Record<TaskStatus, "muted" | "info" | "ok"> = { pending: "muted", in_progress: "info", completed: "ok" };

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{TASK_STATUS_LABELS[status]}</Badge>;
}

export function PriorityLabel({ priority }: { priority: Task["priority"] }) {
  const label = taskPriorityLabel(priority).toLocaleLowerCase("es-UY");
  if (priority === "high") return <Badge variant="bad">Prioridad {label}</Badge>;
  return <span className="text-xs text-muted-foreground">Prioridad {label}</span>;
}

/** Round initial for the assignee; the full label is the accessible name. */
export function AssigneeInitial({ label, className }: { label: string; className?: string }) {
  return (
    <span
      title={label}
      aria-label={`Responsable: ${label}`}
      role="img"
      className={cn("inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-[11px] font-semibold text-muted-foreground", className)}
    >
      {assigneeInitial(label.includes("@") ? label : null)}
    </span>
  );
}
