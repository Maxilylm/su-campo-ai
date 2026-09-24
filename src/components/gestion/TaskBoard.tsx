"use client";

import { useState } from "react";
import { ArrowRightLeft, Clock3, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { taskDueInfo } from "@/lib/task-due";
import { TASK_BOARD_DONE_LIMIT, TASK_STATUS_LABELS, taskBoardColumns, type TaskStatus } from "@/lib/tasks";
import { cn } from "@/lib/utils";
import { AssigneeInitial, DUE_TEXT } from "./TaskBits";
import { taskAssigneeLabel, taskPriorityLabel, type Task, type TaskMember } from "./task-types";

const DRAG_TYPE = "application/x-campoai-task";

function TaskCard({ task, members, statuses, actionReadOnly, onOpen, onMove }: {
  task: Task;
  members: TaskMember[];
  statuses: TaskStatus[];
  actionReadOnly: boolean;
  onOpen: (task: Task) => void;
  onMove: (task: Task, status: TaskStatus) => void;
}) {
  const due = taskDueInfo(task.due_date, task.status);
  const assignee = taskAssigneeLabel(task.assigned_to, members);
  const potrero = task.sections?.name;
  return (
    <li
      draggable={!actionReadOnly}
      onDragStart={(event) => {
        event.dataTransfer.setData(DRAG_TYPE, task.id);
        event.dataTransfer.effectAllowed = "move";
      }}
      className={cn("rounded-md border border-border bg-card p-3 shadow-xs", !actionReadOnly && "cursor-grab active:cursor-grabbing")}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={() => onOpen(task)}
          className={cn("min-w-0 flex-1 rounded-sm text-left text-sm font-medium outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50", task.status === "completed" && "text-muted-foreground line-through")}
        >
          {task.title}
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-xs" disabled={actionReadOnly} aria-label={`Mover tarea: ${task.title}`} className="-mt-0.5 -mr-1">
              <ArrowRightLeft aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Mover a…</DropdownMenuLabel>
            {statuses.filter((status) => status !== task.status).map((status) => (
              <DropdownMenuItem key={status} onSelect={() => onMove(task, status)}>{TASK_STATUS_LABELS[status]}</DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {task.priority === "high"
          ? <span className="font-medium text-bad">Prioridad alta</span>
          : <span className="text-muted-foreground">Prioridad {taskPriorityLabel(task.priority).toLocaleLowerCase("es-UY")}</span>}
        {(task.due_date || task.status !== "completed") && (
          <span className={cn("flex items-center gap-1", DUE_TEXT[due.tone])}><Clock3 className="h-3.5 w-3.5" aria-hidden="true" />{due.label}</span>
        )}
        {potrero && <span className="flex min-w-0 items-center gap-1 text-muted-foreground"><MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span className="truncate">{potrero}</span></span>}
        {assignee && <AssigneeInitial label={assignee} className="ml-auto" />}
      </div>
    </li>
  );
}

/** Kanban: Por hacer / En curso / Hecha. Drag a card to another column, or
 * use its "Mover a…" menu (keyboard and touch). */
export function TaskBoard({ tasks, members, includeInProgress, actionReadOnly, onOpen, onMove }: {
  tasks: Task[];
  members: TaskMember[];
  includeInProgress: boolean;
  actionReadOnly: boolean;
  onOpen: (task: Task) => void;
  onMove: (task: Task, status: TaskStatus) => void;
}) {
  const [dropTarget, setDropTarget] = useState<TaskStatus | null>(null);
  const columns = taskBoardColumns(tasks, { includeInProgress });
  const statuses = columns.map((column) => column.status);

  return (
    <div className={cn("grid gap-4", includeInProgress ? "md:grid-cols-3" : "md:grid-cols-2")}>
      {columns.map((column) => {
        const headingId = `task-column-${column.status}`;
        return (
          <section
            key={column.status}
            aria-labelledby={headingId}
            onDragOver={(event) => {
              if (actionReadOnly || !event.dataTransfer.types.includes(DRAG_TYPE)) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setDropTarget(column.status);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setDropTarget(null);
              const task = tasks.find((item) => item.id === event.dataTransfer.getData(DRAG_TYPE));
              if (task && task.status !== column.status) onMove(task, column.status);
            }}
            className={cn("flex min-h-32 flex-col rounded-lg border border-border bg-muted/40 p-2 transition-colors", dropTarget === column.status && "border-primary bg-accent")}
          >
            <h2 id={headingId} className="flex items-baseline justify-between gap-2 px-1.5 pt-1 pb-2 text-sm font-semibold">
              {column.label}
              <span className="figure text-muted-foreground">{column.total}</span>
            </h2>
            {column.tasks.length === 0 ? (
              <p className="px-1.5 pb-2 text-xs text-muted-foreground">{actionReadOnly ? "Sin tareas." : "Sin tareas. Arrastrá una tarjeta hasta acá."}</p>
            ) : (
              <ul className="space-y-2">
                {column.tasks.map((task) => (
                  <TaskCard key={task.id} task={task} members={members} statuses={statuses} actionReadOnly={actionReadOnly} onOpen={onOpen} onMove={onMove} />
                ))}
              </ul>
            )}
            {column.status === "completed" && column.total > column.tasks.length && (
              <p className="px-1.5 pt-2 text-xs text-muted-foreground">Se muestran las últimas {TASK_BOARD_DONE_LIMIT} de {column.total}. Las demás están en Lista › Completadas.</p>
            )}
          </section>
        );
      })}
    </div>
  );
}
