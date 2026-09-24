"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Clock3, Pencil, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatActivityDate } from "@/lib/activity";
import { fetchWithTimeout } from "@/lib/fetch";
import { taskDueInfo } from "@/lib/task-due";
import { buildTaskHistory, type TaskHistoryActivity } from "@/lib/task-history";
import { TASK_STATUS_LABELS, taskRelationLinks, type TaskStatus } from "@/lib/tasks";
import { cn } from "@/lib/utils";
import { DUE_TEXT } from "./TaskBits";
import { TASK_PRIORITIES, type Task, type TaskMember } from "./task-types";

export interface TaskQuickPatch {
  status?: TaskStatus;
  priority?: Task["priority"];
  assignedTo?: string | null;
}

/** The audit rows of one task; empty (fallback to the task's own dates) when
 * offline or when the feed cannot be read. */
function useTaskActivities(taskId: string | null, stamp: string | undefined, enabled: boolean) {
  const [state, setState] = useState<{ taskId: string | null; rows: TaskHistoryActivity[]; loading: boolean }>({ taskId: null, rows: [], loading: false });
  useEffect(() => {
    if (!taskId || !enabled) return;
    const controller = new AbortController();
    // A refetch of the same task keeps its rows on screen until the new ones arrive.
    const params = new URLSearchParams({ recordTable: "tasks", recordId: taskId, limit: "30" });
    fetchWithTimeout(`/api/activities?${params}`, { signal: controller.signal, cache: "no-store" }, 8000)
      .then(async (response) => (response.ok ? await response.json().catch(() => []) : []))
      .then((rows) => { if (!controller.signal.aborted) setState({ taskId, rows: Array.isArray(rows) ? rows : [], loading: false }); })
      .catch(() => { if (!controller.signal.aborted) setState({ taskId, rows: [], loading: false }); });
    return () => controller.abort();
  }, [taskId, stamp, enabled]);
  return state.taskId === taskId ? state : { taskId, rows: [], loading: enabled && Boolean(taskId) };
}

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      {htmlFor ? <Label htmlFor={htmlFor}>{label}</Label> : <p className="text-sm font-medium">{label}</p>}
      {children}
    </div>
  );
}

/** A task as a ticket: status, priority and assignee change in place; title,
 * dates and links through "Editar". */
export function TaskDetailSheet({ task, members, statusOptions, assigneeAvailable, actionReadOnly, historyEnabled, onClose, onUpdate, onEdit, onDelete }: {
  task: Task | null;
  members: TaskMember[];
  statusOptions: TaskStatus[];
  assigneeAvailable: boolean;
  actionReadOnly: boolean;
  historyEnabled: boolean;
  onClose: () => void;
  onUpdate: (task: Task, patch: TaskQuickPatch) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => Promise<void>;
}) {
  const activities = useTaskActivities(task?.id ?? null, task?.updated_at ?? task?.completed_at ?? task?.status, historyEnabled);
  const due = task ? taskDueInfo(task.due_date, task.status) : null;
  const relations = task ? taskRelationLinks(task) : [];
  const history = task ? buildTaskHistory(task, activities.rows) : [];
  const assignedMissing = Boolean(task?.assigned_to && !members.some((member) => member.user_id === task.assigned_to));

  return (
    <Sheet open={Boolean(task)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent className="overflow-y-auto">
        {task && due && (
          <>
            <SheetHeader className="pr-10">
              <SheetTitle className="text-lg leading-snug">{task.title}</SheetTitle>
              <SheetDescription>{TASK_STATUS_LABELS[task.status]}{task.created_at ? ` · creada el ${new Date(task.created_at).toLocaleDateString("es-UY")}` : ""}</SheetDescription>
            </SheetHeader>
            <div className="grid gap-5 px-4 py-2">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Estado" htmlFor="task-detail-status">
                  <Select value={task.status} onValueChange={(status) => onUpdate(task, { status: status as TaskStatus })} disabled={actionReadOnly}>
                    <SelectTrigger id="task-detail-status" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>{statusOptions.map((status) => <SelectItem key={status} value={status}>{TASK_STATUS_LABELS[status]}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
                <Field label="Prioridad" htmlFor="task-detail-priority">
                  <Select value={task.priority} onValueChange={(priority) => onUpdate(task, { priority: priority as Task["priority"] })} disabled={actionReadOnly}>
                    <SelectTrigger id="task-detail-priority" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>{TASK_PRIORITIES.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
              </div>

              {assigneeAvailable && (
                <Field label="Responsable" htmlFor="task-detail-assignee">
                  <Select value={task.assigned_to || "none"} onValueChange={(value) => onUpdate(task, { assignedTo: value === "none" ? null : value })} disabled={actionReadOnly}>
                    <SelectTrigger id="task-detail-assignee" className="w-full"><SelectValue placeholder="Sin asignar" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sin asignar</SelectItem>
                      {assignedMissing && task.assigned_to && <SelectItem value={task.assigned_to}>{members.length > 0 ? "Ex miembro" : "Miembro del campo"}</SelectItem>}
                      {members.map((member) => <SelectItem key={member.user_id} value={member.user_id}>{member.email || "Miembro sin email"}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
              )}

              <Field label="Vencimiento">
                <p className={cn("flex items-center gap-1.5 text-sm", DUE_TEXT[due.tone])}>
                  <Clock3 className="h-4 w-4" aria-hidden="true" />{due.label}
                  {task.due_date && due.tone !== "muted" && <span className="text-muted-foreground">· {new Date(`${task.due_date}T00:00:00`).toLocaleDateString("es-UY")}</span>}
                </p>
              </Field>

              <Field label="Vinculada a">
                {relations.length === 0
                  ? <p className="text-sm text-muted-foreground">Sin potrero, lote ni cultivo.</p>
                  : (
                    <ul className="space-y-1 text-sm">
                      {relations.map((relation) => (
                        <li key={relation.label}>{relation.href ? <Link href={relation.href} className="text-primary hover:underline">{relation.label}</Link> : relation.label}</li>
                      ))}
                    </ul>
                  )}
              </Field>

              <Field label="Descripción">
                <p className={cn("text-sm whitespace-pre-wrap", !task.description && "text-muted-foreground")}>{task.description || "Sin descripción."}</p>
              </Field>

              <section aria-labelledby="task-detail-history" className="grid gap-2">
                <h3 id="task-detail-history" className="text-sm font-medium">Historial</h3>
                {activities.loading && history.length === 0
                  ? <p className="text-sm text-muted-foreground">Cargando historial…</p>
                  : history.length === 0
                    ? <p className="text-sm text-muted-foreground">Sin movimientos registrados.</p>
                    : (
                      <ol className="space-y-1.5 border-l border-border pl-3 text-sm">
                        {history.map((entry) => (
                          <li key={entry.id} className="flex justify-between gap-3">
                            <span className={entry.label === "Completada" ? "text-ok" : undefined}>{entry.label}</span>
                            <time dateTime={entry.at} className="figure text-muted-foreground">{formatActivityDate(entry.at)}</time>
                          </li>
                        ))}
                      </ol>
                    )}
              </section>
            </div>
            <SheetFooter className="flex-row justify-between">
              <ConfirmDialog
                trigger={<Button variant="ghost" disabled={actionReadOnly} className="text-muted-foreground hover:text-destructive"><Trash2 aria-hidden="true" />Eliminar</Button>}
                title="¿Eliminar tarea?"
                description="Esta acción no se puede deshacer."
                onConfirm={() => onDelete(task)}
              />
              <Button variant="outline" onClick={() => onEdit(task)} disabled={actionReadOnly}><Pencil aria-hidden="true" />Editar</Button>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
