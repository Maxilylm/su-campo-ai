"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useFarm } from "@/contexts/FarmContext";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { LoadingPage } from "@/components/LoadingPage";
import { LoadErrorState } from "@/components/LoadErrorState";
import { StatStrip } from "@/components/StatCard";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { CalendarDays, CheckCircle2, ClipboardCheck, Columns3, Download, List, Plus, RefreshCw, UserRound, WifiOff } from "lucide-react";
import { sendJsonResult } from "@/lib/mutate";
import {
  filterTasks, filterTasksByAssignee, isTaskOverdue, TASK_STATUS_LABELS, taskStatusOptions, taskStatusPatch, toggledTaskStatus,
  type TaskListFilter, type TaskStatus,
} from "@/lib/tasks";
import { downloadAuthenticatedFile } from "@/lib/download";
import { useOfflineAwareReplace } from "@/lib/use-offline-aware-navigation";
import { UnsavedChangesDialog } from "@/components/UnsavedChangesDialog";
import { AuthenticatedDownloadLink } from "@/components/AuthenticatedDownloadLink";
import { CampoAIButton } from "@/components/CampoAIButton";
import { Notice } from "@/components/gestion/Notice";
import { SegmentedControl } from "@/components/gestion/SegmentedControl";
import { TaskList } from "@/components/gestion/TaskList";
import { TaskBoard } from "@/components/gestion/TaskBoard";
import { TaskSheet } from "@/components/gestion/TaskSheet";
import { TaskDetailSheet, type TaskQuickPatch } from "@/components/gestion/TaskDetailSheet";
import { useTasksData } from "@/components/gestion/useTasksData";
import { useTaskForm } from "@/components/gestion/useTaskForm";
import type { Task } from "@/components/gestion/task-types";

const FILTER_OPTIONS = [
  { value: "pending", label: "Pendientes" },
  { value: "overdue", label: "Vencidas" },
  { value: "all", label: "Todas" },
  { value: "completed", label: "Completadas" },
] as const;
const BOARD_FILTER_OPTIONS = [
  { value: "all", label: "Todas" },
  { value: "overdue", label: "Vencidas" },
] as const;
type TaskView = "list" | "board";
const VIEW_OPTIONS = [
  { value: "list", label: "Lista", icon: List },
  { value: "board", label: "Tablero", icon: Columns3 },
] as const;

const viewKey = (userId: string) => `campoai:tasks-view:${encodeURIComponent(userId)}`;

function statusToast(from: TaskStatus, to: TaskStatus): string {
  if (to === "completed") return "Tarea completada";
  if (to === "in_progress") return "Tarea en curso";
  return from === "completed" ? "Tarea reabierta" : "Tarea movida a Por hacer";
}

function TareasPageContent() {
  const { sections, userId, offlineMode, isOnline, readOnly: permissionReadOnly } = useFarm();
  const replace = useOfflineAwareReplace();
  const searchParams = useSearchParams();
  const navigationQuery = searchParams.toString();
  const offlineReadOnly = offlineMode || !isOnline;
  const actionReadOnly = offlineReadOnly || permissionReadOnly;
  const data = useTasksData({ userId, offlineReadOnly });
  const { tasks, setTasks, members, loaded, loadError, migrationRequired, boardMigrationRequired, tasksTruncated, agendaSyncedAt, loadData } = data;
  const boardAvailable = !boardMigrationRequired;
  const statusOptions = taskStatusOptions(boardAvailable);
  const form = useTaskForm({ cattle: data.cattle, crops: data.crops, actionReadOnly, assigneeAvailable: boardAvailable, onSaved: loadData });
  const [refreshing, setRefreshing] = useState(false);
  const [calendarDownloading, setCalendarDownloading] = useState(false);
  const [filter, setFilter] = useState<TaskListFilter>("pending");
  const [mineOnly, setMineOnly] = useState(false);
  const [view, setViewState] = useState<TaskView>("list");
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null);
  const handledNavigationQueryRef = useRef<string | null>(null);
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;

  // Read after mount: the server render has no localStorage.
  useEffect(() => {
    if (!userId) return;
    try {
      const saved = window.localStorage.getItem(viewKey(userId));
      if (saved === "board" || saved === "list") setViewState(saved);
    } catch {
      // Blocked storage keeps the default list.
    }
  }, [userId]);

  function setView(next: TaskView) {
    setViewState(next);
    if (!userId) return;
    try { window.localStorage.setItem(viewKey(userId), next); } catch { /* per-viewer convenience only */ }
  }

  useEffect(() => {
    if (!loaded || handledNavigationQueryRef.current === navigationQuery) return;
    const params = new URLSearchParams(navigationQuery);
    const taskId = params.get("taskId");
    if (params.get("new") === "1" && params.get("title") && !migrationRequired && !actionReadOnly) {
      form.openNewTask({
        title: params.get("title") || "",
        description: params.get("description") || "",
        dueDate: params.get("dueDate") || "",
        priority: params.get("priority") === "high" ? "high" : "medium",
        sectionId: params.get("sectionId") || "",
        cattleId: params.get("cattleId") || "",
        cropId: params.get("cropId") || "",
      });
    }
    if (taskId && !tasks.some((task) => task.id === taskId)) return;
    if (taskId) {
      setFilter("all");
      setFocusedTaskId(taskId);
      setDetailTaskId(taskId);
    }
    handledNavigationQueryRef.current = navigationQuery;
    if (navigationQuery) replace(window.location.pathname, { scroll: false });
    // form.openNewTask is recreated each render; the query guard runs it once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionReadOnly, loaded, migrationRequired, navigationQuery, replace, tasks]);

  const scopedTasks = useMemo(
    () => (mineOnly && boardAvailable ? filterTasksByAssignee(tasks, userId) : tasks),
    [boardAvailable, mineOnly, tasks, userId],
  );
  const boardFilter: TaskListFilter = filter === "overdue" ? "overdue" : "all";
  const visibleTasks = useMemo(() => filterTasks(scopedTasks, view === "board" ? boardFilter : filter), [scopedTasks, view, boardFilter, filter]);
  const detailTask = detailTaskId ? tasks.find((task) => task.id === detailTaskId) ?? null : null;
  const pendingCount = tasks.filter((task) => task.status === "pending").length;
  const inProgressCount = tasks.filter((task) => task.status === "in_progress").length;
  const overdueCount = tasks.filter((task) => isTaskOverdue(task.due_date, task.status)).length;
  const completedCount = tasks.filter((task) => task.status === "completed").length;
  const tasksAIFacts = [
    `Filtro visible: ${filter}${mineOnly ? " (asignadas a mí)" : ""}`,
    `Por hacer: ${pendingCount}`,
    ...(boardAvailable ? [`En curso: ${inProgressCount}`] : []),
    `Vencidas: ${overdueCount}`,
    `Completadas: ${completedCount}`,
    ...visibleTasks.slice(0, 30).map((task) => `${task.title} — ${TASK_STATUS_LABELS[task.status]}${task.due_date ? ` — vence ${task.due_date}` : " — sin fecha"} — prioridad ${task.priority}`),
  ];

  useEffect(() => {
    if (!focusedTaskId) return;
    const task = document.getElementById(`task-${focusedTaskId}`);
    if (!task) return;
    task.scrollIntoView({ behavior: "smooth", block: "center" });
    const timer = window.setTimeout(() => setFocusedTaskId(null), 4000);
    return () => window.clearTimeout(timer);
  }, [focusedTaskId, visibleTasks.length]);

  /** Optimistic quick edit (status, priority, assignee); rolls the changed
   * fields back if the API refuses. Status changes offer "Deshacer". */
  async function updateTask(task: Task, patch: TaskQuickPatch, { undo = true }: { undo?: boolean } = {}) {
    if (actionReadOnly) return;
    const current = tasksRef.current.find((item) => item.id === task.id) ?? task;
    const local: Partial<Task> = {};
    if (patch.status) Object.assign(local, taskStatusPatch(patch.status));
    if (patch.priority) local.priority = patch.priority;
    if ("assignedTo" in patch) local.assigned_to = patch.assignedTo ?? null;
    const rollback = Object.fromEntries(Object.keys(local).map((key) => [key, current[key as keyof Task] ?? null])) as Partial<Task>;
    setTasks((rows) => rows.map((row) => (row.id === task.id ? { ...row, ...local } : row)));
    const result = await sendJsonResult("/api/tasks", "PUT", {
      id: task.id,
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.priority ? { priority: patch.priority } : {}),
      ...("assignedTo" in patch ? { assignedTo: patch.assignedTo ?? null } : {}),
    });
    if (!result.ok) {
      setTasks((rows) => rows.map((row) => (row.id === task.id ? { ...row, ...rollback } : row)));
      toast.error(result.error || "No se pudo actualizar la tarea. Intentá de nuevo.");
      return;
    }
    if (patch.status && patch.status !== current.status) {
      const previous = current.status;
      toast.success(statusToast(previous, patch.status), undo
        ? { action: { label: "Deshacer", onClick: () => void updateTask(task, { status: previous }, { undo: false }) } }
        : undefined);
    } else if (!patch.status) {
      toast.success("Tarea actualizada");
    }
  }

  function toggleTask(task: Task) {
    void updateTask(task, { status: toggledTaskStatus(task.status) });
  }

  async function deleteTask(task: Task) {
    if (actionReadOnly) return;
    const result = await sendJsonResult("/api/tasks", "DELETE", { id: task.id });
    if (result.ok) {
      setDetailTaskId(null);
      setTasks((current) => current.filter((row) => row.id !== task.id));
      toast.success("Tarea eliminada");
    } else toast.error(result.error || "No se pudo eliminar la tarea. Intentá de nuevo.");
  }

  function editFromDetail(task: Task) {
    setDetailTaskId(null);
    form.openEditTask(task);
  }

  async function refresh() {
    setRefreshing(true);
    try { await loadData(); } finally { setRefreshing(false); }
  }

  async function downloadCalendar() {
    if (offlineReadOnly || calendarDownloading) return;
    setCalendarDownloading(true);
    try {
      const result = await downloadAuthenticatedFile("/api/calendar", "campoai-calendario.ics");
      if (!result.ok) toast.error("No se pudo descargar el calendario", { description: result.error });
      else toast.success("Calendario descargado");
    } catch {
      toast.error("No se pudo descargar el calendario", { description: "Revisá tu conexión e intentá nuevamente." });
    } finally {
      setCalendarDownloading(false);
    }
  }

  if (!loaded) return <LoadingPage />;
  if (loadError) {
    return (
      <LoadErrorState
        title={offlineReadOnly ? "No hay una copia local de la agenda" : "No se pudo cargar la agenda"}
        description={offlineReadOnly ? "Conectate a internet y sincronizá Mi campo para consultar las tareas sin conexión." : loadError}
        onRetry={offlineReadOnly ? undefined : loadData}
      />
    );
  }

  const canCreate = !migrationRequired && !actionReadOnly && (view === "board" || (filter !== "completed" && filter !== "overdue"));
  const showEmpty = view === "list" ? visibleTasks.length === 0 : scopedTasks.length === 0;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Tareas"
        description="Organizá el trabajo y vinculalo al potrero, lote o cultivo que corresponde."
        actions={
          <>
            <CampoAIButton title="Agenda de tareas" facts={tasksAIFacts} partial={tasksTruncated || migrationRequired} instruction="Ayudame a ordenar prioridades y convertir hallazgos claros en tareas con fecha solo cuando esté respaldada por los datos." disabled={migrationRequired} />
            <Button variant="ghost" onClick={refresh} disabled={refreshing || offlineReadOnly}><RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} aria-hidden="true" />{refreshing ? "Actualizando…" : "Actualizar"}</Button>
            {migrationRequired || offlineReadOnly
              ? <Button variant="ghost" disabled title={offlineReadOnly ? "Necesitás conexión para descargarlo" : undefined}><Download className="h-4 w-4" aria-hidden="true" />Exportar CSV</Button>
              : <Button variant="ghost" asChild><AuthenticatedDownloadLink href="/api/export?format=csv&table=tasks" filename="campoai-tareas.csv"><Download className="h-4 w-4" aria-hidden="true" />Exportar CSV</AuthenticatedDownloadLink></Button>}
            {offlineReadOnly
              ? <Button variant="ghost" disabled title="Necesitás conexión para descargarlo"><CalendarDays className="h-4 w-4" aria-hidden="true" />Calendario</Button>
              : <Button variant="ghost" onClick={() => void downloadCalendar()} disabled={calendarDownloading}><CalendarDays className="h-4 w-4" aria-hidden="true" />{calendarDownloading ? "Descargando…" : "Calendario"}</Button>}
            <Button onClick={() => form.openNewTask()} disabled={migrationRequired || actionReadOnly}><Plus className="h-4 w-4" aria-hidden="true" />Nueva tarea</Button>
          </>
        }
      />

      {((offlineReadOnly && agendaSyncedAt) || migrationRequired || tasksTruncated) && (
        <div className="space-y-3">
          {offlineReadOnly && agendaSyncedAt && (
            <Notice icon={WifiOff} title="Agenda en modo lectura">
              Mostrando la última agenda sincronizada el {new Date(agendaSyncedAt).toLocaleString("es-UY")}. Los cambios se habilitan al recuperar la conexión.
            </Notice>
          )}
          {migrationRequired && (
            <Notice tone="warn" icon={ClipboardCheck} title="La agenda necesita una actualización de Supabase">
              Aplicá <code>supabase/014_tasks.sql</code> en el SQL Editor para activar el guardado de tareas.
            </Notice>
          )}
          {tasksTruncated && (
            <Notice>
              Se muestran las 500 tareas más recientes. Para ver la agenda completa,{" "}
              <AuthenticatedDownloadLink href="/api/export?format=csv&table=tasks" filename="campoai-tareas.csv" className="font-medium text-primary underline-offset-2 hover:underline">descargá las tareas (CSV)</AuthenticatedDownloadLink>.
            </Notice>
          )}
        </div>
      )}

      <StatStrip
        items={[
          { label: "Por hacer", value: pendingCount },
          ...(boardAvailable ? [{ label: "En curso", value: inProgressCount }] : []),
          { label: "Vencidas", value: overdueCount, tone: overdueCount > 0 ? "bad" as const : undefined },
          { label: "Completadas", value: completedCount },
        ]}
      />

      <section aria-label={view === "board" ? "Tablero de tareas" : "Lista de tareas"} className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {view === "board"
              ? <SegmentedControl label="Filtrar tablero" options={BOARD_FILTER_OPTIONS} value={boardFilter as "all" | "overdue"} onChange={setFilter} />
              : <SegmentedControl label="Filtrar tareas" options={FILTER_OPTIONS} value={filter} onChange={setFilter} />}
            {boardAvailable && userId && (
              <Button variant={mineOnly ? "secondary" : "ghost"} size="sm" aria-pressed={mineOnly} onClick={() => setMineOnly((value) => !value)}>
                <UserRound aria-hidden="true" />Asignadas a mí
              </Button>
            )}
          </div>
          <SegmentedControl label="Vista" options={VIEW_OPTIONS} value={view} onChange={setView} />
        </div>

        {showEmpty ? (
          <EmptyState
            icon={filter === "completed" && view === "list" ? CheckCircle2 : ClipboardCheck}
            title={mineOnly ? "No tenés tareas asignadas" : view === "board" ? "Todavía no hay tareas" : filter === "completed" ? "Todavía no hay tareas completadas" : filter === "overdue" ? "No hay tareas vencidas" : filter === "all" ? "Todavía no hay tareas" : "No hay tareas pendientes"}
            description={offlineReadOnly ? "La agenda queda en modo lectura hasta recuperar la conexión." : permissionReadOnly ? "Tu acceso permite consultar la agenda, pero no modificar tareas." : migrationRequired ? "La agenda va a estar disponible después de aplicar la migración." : mineOnly ? "Cuando alguien te asigne una tarea, la vas a ver acá." : filter === "overdue" && view === "list" ? "Buen trabajo: no hay tareas pendientes fuera de fecha." : "Cargá tu primera tarea para no perder el próximo trabajo del campo."}
            actionLabel={canCreate && !mineOnly ? "Crear tarea" : undefined}
            onAction={canCreate && !mineOnly ? () => form.openNewTask() : undefined}
          />
        ) : view === "board" ? (
          <TaskBoard
            tasks={visibleTasks}
            members={members}
            includeInProgress={boardAvailable}
            actionReadOnly={actionReadOnly}
            onOpen={(task) => setDetailTaskId(task.id)}
            onMove={(task, status) => void updateTask(task, { status })}
          />
        ) : (
          <TaskList
            tasks={visibleTasks}
            members={members}
            focusedTaskId={focusedTaskId}
            actionReadOnly={actionReadOnly}
            onToggle={toggleTask}
            onOpen={(task) => setDetailTaskId(task.id)}
          />
        )}
      </section>

      <TaskDetailSheet
        task={detailTask}
        members={members}
        statusOptions={statusOptions}
        assigneeAvailable={boardAvailable}
        actionReadOnly={actionReadOnly}
        historyEnabled={!offlineReadOnly}
        onClose={() => setDetailTaskId(null)}
        onUpdate={(task, patch) => void updateTask(task, patch)}
        onEdit={editFromDetail}
        onDelete={deleteTask}
      />
      <TaskSheet
        open={form.sheetOpen}
        onOpen={() => form.setSheetOpen(true)}
        onRequestClose={form.requestSheetClose}
        form={form.form}
        onChange={form.updateForm}
        onSectionChange={form.changeSection}
        onCattleChange={form.changeCattle}
        onCropChange={form.changeCrop}
        contextMismatch={form.contextMismatch}
        onSave={form.saveTask}
        saveDisabled={form.saving || actionReadOnly || !form.form.title.trim() || form.contextMismatch}
        saving={form.saving}
        sections={sections}
        cattle={form.availableCattle}
        crops={form.availableCrops}
        members={boardAvailable ? members : null}
      />
      <UnsavedChangesDialog open={form.discardDialogOpen} onOpenChange={form.setDiscardDialogOpen} onDiscard={form.discardFormChanges} />
    </div>
  );
}

export default function TareasPage() {
  return <Suspense fallback={<LoadingPage />}><TareasPageContent /></Suspense>;
}
