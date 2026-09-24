"use client";

import Link from "next/link";
import { Check, CheckCircle2, Clock3, Pencil, Trash2, Undo2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { taskDueInfo, type TaskDueTone } from "@/lib/task-due";
import { taskRelationLinks } from "@/lib/tasks";
import { cn } from "@/lib/utils";
import { TASK_PRIORITIES, type Task } from "./task-types";

const DUE_TEXT: Record<TaskDueTone, string> = { bad: "text-bad", warn: "text-warn", muted: "text-muted-foreground" };

function PriorityLabel({ priority }: { priority: Task["priority"] }) {
  const label = TASK_PRIORITIES.find((item) => item.value === priority)?.label;
  if (priority === "high") return <Badge variant="bad">Prioridad {label?.toLocaleLowerCase()}</Badge>;
  return <span className="text-xs text-muted-foreground">Prioridad {label?.toLocaleLowerCase()}</span>;
}

export function TaskList({ tasks, focusedTaskId, actionReadOnly, onToggle, onEdit, onDelete }: {
  tasks: Task[];
  focusedTaskId: string | null;
  actionReadOnly: boolean;
  onToggle: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
      {tasks.map((task) => {
        const completed = task.status === "completed";
        const due = taskDueInfo(task.due_date, task.status);
        const relations = taskRelationLinks(task);
        return (
          <li id={`task-${task.id}`} key={task.id} className={cn("flex items-start gap-3 px-4 py-3 transition-colors", focusedTaskId === task.id && "bg-accent")}>
            <button
              type="button"
              onClick={() => onToggle(task)}
              disabled={actionReadOnly}
              aria-label={completed ? `Reabrir tarea: ${task.title}` : `Completar tarea: ${task.title}`}
              className="mt-0.5 shrink-0 rounded-full text-muted-foreground outline-none hover:text-primary focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {completed
                ? <CheckCircle2 className="h-5 w-5 text-ok" aria-hidden="true" />
                : <span className="block h-5 w-5 rounded-full border-2 border-muted-foreground/50" aria-hidden="true" />}
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className={cn("font-medium", completed && "text-muted-foreground line-through")}>{task.title}</span>
                <PriorityLabel priority={task.priority} />
              </div>
              {task.description && <p className="mt-0.5 text-sm text-muted-foreground">{task.description}</p>}
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
            <div className="-mr-2 flex shrink-0 gap-0.5">
              <Button variant="ghost" size="icon-sm" onClick={() => onEdit(task)} disabled={actionReadOnly} aria-label={`Editar tarea: ${task.title}`}><Pencil className="h-4 w-4" /></Button>
              <Button variant="ghost" size="icon-sm" onClick={() => onToggle(task)} disabled={actionReadOnly} aria-label={completed ? `Reabrir: ${task.title}` : `Completar: ${task.title}`} className="hidden sm:inline-flex">
                {completed ? <Undo2 className="h-4 w-4" /> : <Check className="h-4 w-4" />}
              </Button>
              <ConfirmDialog
                trigger={<Button variant="ghost" size="icon-sm" disabled={actionReadOnly} aria-label={`Eliminar tarea: ${task.title}`}><Trash2 className="h-4 w-4 text-muted-foreground" /></Button>}
                title="¿Eliminar tarea?"
                description="Esta acción no se puede deshacer."
                onConfirm={() => onDelete(task.id)}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
