"use client";

import Link from "next/link";
import { CheckCircle2, CircleDot, Clock3 } from "lucide-react";
import { taskDueInfo } from "@/lib/task-due";
import { taskRelationLinks } from "@/lib/tasks";
import { cn } from "@/lib/utils";
import { AssigneeInitial, DUE_TEXT, PriorityLabel, TaskStatusBadge } from "./TaskBits";
import { taskAssigneeLabel, type Task, type TaskMember } from "./task-types";

/** Clicking a row opens the task; only the round checkbox completes it. */
export function TaskList({ tasks, members, focusedTaskId, actionReadOnly, onToggle, onOpen }: {
  tasks: Task[];
  members: TaskMember[];
  focusedTaskId: string | null;
  actionReadOnly: boolean;
  onToggle: (task: Task) => void;
  onOpen: (task: Task) => void;
}) {
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
      {tasks.map((task) => {
        const completed = task.status === "completed";
        const due = taskDueInfo(task.due_date, task.status);
        const relations = taskRelationLinks(task);
        const assignee = taskAssigneeLabel(task.assigned_to, members);
        return (
          <li
            id={`task-${task.id}`}
            key={task.id}
            onClick={(event) => {
              // The whole row opens the ticket, except its own links and buttons.
              if ((event.target as HTMLElement).closest("a, button")) return;
              onOpen(task);
            }}
            className={cn("flex cursor-pointer items-start gap-3 px-4 py-3 transition-colors hover:bg-accent/50", focusedTaskId === task.id && "bg-accent")}
          >
            <button
              type="button"
              onClick={() => onToggle(task)}
              disabled={actionReadOnly}
              aria-label={completed ? `Reabrir tarea: ${task.title}` : `Completar tarea: ${task.title}`}
              className="-m-2.5 shrink-0 rounded-full p-2.5 text-muted-foreground outline-none hover:text-primary focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {completed
                ? <CheckCircle2 className="h-5 w-5 text-ok" aria-hidden="true" />
                : task.status === "in_progress"
                  ? <CircleDot className="h-5 w-5 text-info" aria-hidden="true" />
                  : <span className="block h-5 w-5 rounded-full border-2 border-muted-foreground/50" aria-hidden="true" />}
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <button
                  type="button"
                  onClick={() => onOpen(task)}
                  className={cn("rounded-sm text-left font-medium outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50", completed && "text-muted-foreground line-through")}
                >
                  {task.title}
                </button>
                {task.status === "in_progress" && <TaskStatusBadge status={task.status} />}
                <PriorityLabel priority={task.priority} />
              </div>
              {task.description && <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{task.description}</p>}
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <span className={cn("flex items-center gap-1", DUE_TEXT[due.tone])}>
                  <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />{due.label}
                </span>
                {relations.length > 0 && (
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
                    {relations.map((relation, index) => (
                      <span key={relation.label} className="inline-flex items-center gap-2">
                        {index > 0 && <span aria-hidden="true">·</span>}
                        {relation.href ? <Link href={relation.href} className="text-primary hover:underline">{relation.label}</Link> : relation.label}
                      </span>
                    ))}
                  </span>
                )}
              </div>
            </div>
            {assignee && <AssigneeInitial label={assignee} className="mt-0.5" />}
          </li>
        );
      })}
    </ul>
  );
}
