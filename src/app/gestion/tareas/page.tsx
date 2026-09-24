"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useFarm } from "@/contexts/FarmContext";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { LoadingPage } from "@/components/LoadingPage";
import { LoadErrorState } from "@/components/LoadErrorState";
import { StatStrip } from "@/components/StatCard";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { CalendarDays, CheckCircle2, ClipboardCheck, Download, Plus, RefreshCw, WifiOff } from "lucide-react";
import { createIdempotencyKey, sendJsonResult } from "@/lib/mutate";
import { filterTasks, isTaskOverdue, taskRelationMismatch, type TaskListFilter } from "@/lib/tasks";
import { fetchWithTimeout } from "@/lib/fetch";
import { downloadAuthenticatedFile } from "@/lib/download";
import { useDataChangedRefresh } from "@/lib/use-data-changed-refresh";
import { useOfflineSnapshotRefresh } from "@/lib/use-offline-snapshot-refresh";
import { useOfflineAwareReplace } from "@/lib/use-offline-aware-navigation";
import { isOfflineSnapshotFresh, offlineAgendaSnapshotKey, parseOfflineAgendaSnapshot } from "@/lib/offline";
import { UnsavedChangesDialog } from "@/components/UnsavedChangesDialog";
import { hasUnsavedChanges } from "@/lib/unsaved-changes";
import { useUnsavedChangesWarning } from "@/lib/use-unsaved-changes-warning";
import { AuthenticatedDownloadLink } from "@/components/AuthenticatedDownloadLink";
import { CampoAIButton } from "@/components/CampoAIButton";
import { Notice } from "@/components/gestion/Notice";
import { SegmentedControl } from "@/components/gestion/SegmentedControl";
import { TaskList } from "@/components/gestion/TaskList";
import { TaskSheet } from "@/components/gestion/TaskSheet";
import { EMPTY_TASK_FORM, taskFormSignature, type Task, type TaskFormState, type TaskOptionRow as OptionRow } from "@/components/gestion/task-types";

const FILTER_OPTIONS = [
  { value: "pending", label: "Pendientes" },
  { value: "overdue", label: "Vencidas" },
  { value: "all", label: "Todas" },
  { value: "completed", label: "Completadas" },
] as const;

function TareasPageContent() {
  const { sections, userId, offlineMode, isOnline, readOnly: permissionReadOnly } = useFarm();
  const replace = useOfflineAwareReplace();
  const searchParams = useSearchParams();
  const navigationQuery = searchParams.toString();
  const offlineReadOnly = offlineMode || !isOnline;
  const actionReadOnly = offlineReadOnly || permissionReadOnly;
  const [tasks, setTasks] = useState<Task[]>([]);
  const [cattle, setCattle] = useState<OptionRow[]>([]);
  const [crops, setCrops] = useState<OptionRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [migrationRequired, setMigrationRequired] = useState(false);
  const [tasksTruncated, setTasksTruncated] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [calendarDownloading, setCalendarDownloading] = useState(false);
  const [filter, setFilter] = useState<TaskListFilter>("pending");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<TaskFormState>(EMPTY_TASK_FORM);
  const handledNavigationQueryRef = useRef<string | null>(null);
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null);
  const [agendaSyncedAt, setAgendaSyncedAt] = useState<string | null>(null);
  const requestId = useRef(0);
  const requestRef = useRef<AbortController | null>(null);
  const taskAttempt = useRef<{ key: string; signature: string } | null>(null);
  const formBaselineRef = useRef<string | null>(null);

  const updateForm = (patch: Partial<TaskFormState>) => setForm((current) => ({ ...current, ...patch }));

  const loadData = useCallback(async () => {
    const currentRequest = ++requestId.current;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    if (offlineReadOnly) {
      let cached = null;
      try {
        cached = userId
          ? parseOfflineAgendaSnapshot(window.localStorage.getItem(offlineAgendaSnapshotKey(userId)))
          : null;
      } catch {
        cached = null;
      }
      if (cached && isOfflineSnapshotFresh(cached.savedAt)) {
        setTasks(cached.tasks as Task[]);
        setCattle(cached.cattle as OptionRow[]);
        setCrops(cached.crops as OptionRow[]);
        setMigrationRequired(cached.migrationRequired === true);
        setTasksTruncated(cached.tasksTruncated === true);
        setAgendaSyncedAt(cached.savedAt);
        setLoadError(null);
      } else {
        setAgendaSyncedAt(null);
        setLoadError("La agenda requiere conexión y todavía no hay una sincronización local disponible.");
      }
      setLoaded(true);
      if (requestRef.current === controller) requestRef.current = null;
      return;
    }
    setLoadError(null);
    try {
      const [taskRes, cattleRes, cropRes] = await Promise.all([
        fetchWithTimeout("/api/tasks", { signal: controller.signal }, 8000),
        fetchWithTimeout("/api/cattle", { signal: controller.signal }, 8000),
        fetchWithTimeout("/api/crops", { signal: controller.signal }, 8000),
      ]);
      const payloads = await Promise.all([taskRes, cattleRes, cropRes].map(async (response) => ({
        response,
        payload: await response.json().catch(() => null),
      })));
      const failed = payloads.find(({ response }) => !response.ok);
      if (failed) {
        const message = failed.payload && typeof failed.payload === "object" && "error" in failed.payload && typeof failed.payload.error === "string"
          ? failed.payload.error
          : "No se pudo cargar la agenda.";
        throw new Error(message);
      }
      if (controller.signal.aborted || currentRequest !== requestId.current) return;
      const [taskPayload, cattlePayload, cropPayload] = payloads.map(({ payload }) => payload);
      setTasks(Array.isArray(taskPayload.tasks) ? taskPayload.tasks : []);
      setMigrationRequired(taskPayload.migrationRequired === true);
      setTasksTruncated(taskRes.headers.get("X-CampoAI-Tasks-Truncated") === "true");
      setCattle(Array.isArray(cattlePayload) ? cattlePayload : []);
      setCrops(Array.isArray(cropPayload) ? cropPayload : []);
      const savedAt = new Date().toISOString();
      setAgendaSyncedAt(savedAt);
      if (userId) {
        try {
          window.localStorage.setItem(offlineAgendaSnapshotKey(userId), JSON.stringify({
            tasks: Array.isArray(taskPayload.tasks) ? taskPayload.tasks : [],
            cattle: Array.isArray(cattlePayload) ? cattlePayload : [],
            crops: Array.isArray(cropPayload) ? cropPayload : [],
            savedAt,
            migrationRequired: taskPayload.migrationRequired === true,
            tasksTruncated: taskRes.headers.get("X-CampoAI-Tasks-Truncated") === "true",
          }));
        } catch {
          // Private browsing and storage limits must not block the online agenda.
        }
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      console.error("Load tasks error:", error);
      if (currentRequest === requestId.current) {
        setLoadError(error instanceof Error ? error.message : "No se pudo cargar la agenda.");
      }
    } finally {
      if (currentRequest === requestId.current) setLoaded(true);
      if (requestRef.current === controller) requestRef.current = null;
    }
  }, [offlineReadOnly, userId]);

  useEffect(() => {
    void loadData();
    return () => {
      requestId.current += 1;
      requestRef.current?.abort();
    };
  }, [loadData]);
  useDataChangedRefresh(loadData, !offlineReadOnly);
  useOfflineSnapshotRefresh(loadData, userId, offlineReadOnly);

  useEffect(() => {
    if (!loaded || handledNavigationQueryRef.current === navigationQuery) return;
    const params = new URLSearchParams(navigationQuery);
    const taskId = params.get("taskId");
    if (params.get("new") === "1" && params.get("title") && !migrationRequired && !actionReadOnly) {
      const nextForm: TaskFormState = {
        editingTaskId: null,
        title: params.get("title") || "",
        description: params.get("description") || "",
        dueDate: params.get("dueDate") || "",
        priority: params.get("priority") === "high" ? "high" : "medium",
        sectionId: params.get("sectionId") || "",
        cattleId: params.get("cattleId") || "",
        cropId: params.get("cropId") || "",
      };
      setForm(nextForm);
      formBaselineRef.current = taskFormSignature(nextForm);
      setSheetOpen(true);
    }
    if (taskId && !tasks.some((task) => task.id === taskId)) return;
    if (taskId && tasks.some((task) => task.id === taskId)) {
      setFilter("all");
      setFocusedTaskId(taskId);
    }
    handledNavigationQueryRef.current = navigationQuery;
    if (navigationQuery) replace(window.location.pathname, { scroll: false });
  }, [actionReadOnly, loaded, migrationRequired, navigationQuery, replace, tasks]);

  const visibleTasks = useMemo(
    () => filterTasks(tasks, filter),
    [tasks, filter],
  );
  const { sectionId, cattleId, cropId } = form;
  const selectedCattle = cattle.find((row) => row.id === cattleId);
  const selectedCrop = crops.find((row) => row.id === cropId);
  const contextMismatch = Boolean(
    taskRelationMismatch(sectionId, selectedCattle?.section_id)
    || taskRelationMismatch(sectionId, selectedCrop?.section_id),
  );
  const availableCattle = sectionId
    ? cattle.filter((row) => !row.section_id || row.section_id === sectionId || row.id === cattleId)
    : cattle;
  const availableCrops = sectionId
    ? crops.filter((row) => !row.section_id || row.section_id === sectionId || row.id === cropId)
    : crops;
  const pendingCount = tasks.filter((task) => task.status === "pending").length;
  const overdueCount = tasks.filter((task) => isTaskOverdue(task.due_date, task.status)).length;
  const completedCount = tasks.filter((task) => task.status === "completed").length;
  const tasksAIFacts = [
    `Filtro visible: ${filter}`,
    `Pendientes: ${pendingCount}`,
    `Vencidas: ${overdueCount}`,
    `Completadas: ${completedCount}`,
    ...visibleTasks.slice(0, 30).map((task) => `${task.title}${task.due_date ? ` — vence ${task.due_date}` : " — sin fecha"} — prioridad ${task.priority}`),
  ];

  useEffect(() => {
    if (!focusedTaskId) return;
    const task = document.getElementById(`task-${focusedTaskId}`);
    if (!task) return;
    task.scrollIntoView({ behavior: "smooth", block: "center" });
    const timer = window.setTimeout(() => setFocusedTaskId(null), 4000);
    return () => window.clearTimeout(timer);
  }, [focusedTaskId, visibleTasks.length]);

  function resetForm() {
    formBaselineRef.current = null;
    setForm(EMPTY_TASK_FORM);
  }

  function openNewTask() {
    if (actionReadOnly) return;
    resetForm();
    formBaselineRef.current = taskFormSignature(EMPTY_TASK_FORM);
    setSheetOpen(true);
  }

  function openEditTask(task: Task) {
    if (actionReadOnly) return;
    const nextForm: TaskFormState = {
      editingTaskId: task.id,
      title: task.title,
      description: task.description || "",
      dueDate: task.due_date || "",
      priority: task.priority,
      sectionId: task.section_id || "",
      cattleId: task.cattle_id || "",
      cropId: task.crop_id || "",
    };
    setForm(nextForm);
    formBaselineRef.current = taskFormSignature(nextForm);
    setSheetOpen(true);
  }

  useUnsavedChangesWarning(sheetOpen && hasUnsavedChanges(formBaselineRef.current, taskFormSignature(form)));

  function discardFormChanges() {
    setDiscardDialogOpen(false);
    setSheetOpen(false);
    resetForm();
  }

  function requestSheetClose() {
    if (saving) return;
    if (hasUnsavedChanges(formBaselineRef.current, taskFormSignature(form))) {
      setDiscardDialogOpen(true);
      return;
    }
    setSheetOpen(false);
    resetForm();
  }

  function changeSection(value: string) {
    const nextSectionId = value === "none" ? "" : value;
    setForm((current) => {
      if (!nextSectionId) return { ...current, sectionId: nextSectionId };
      const cattleRelation = cattle.find((row) => row.id === current.cattleId);
      const cropRelation = crops.find((row) => row.id === current.cropId);
      return {
        ...current,
        sectionId: nextSectionId,
        cattleId: cattleRelation?.section_id && cattleRelation.section_id !== nextSectionId ? "" : current.cattleId,
        cropId: cropRelation?.section_id && cropRelation.section_id !== nextSectionId ? "" : current.cropId,
      };
    });
  }

  function changeCattle(value: string) {
    const nextCattleId = value === "none" ? "" : value;
    const relation = cattle.find((row) => row.id === nextCattleId);
    updateForm(relation?.section_id ? { cattleId: nextCattleId, sectionId: relation.section_id } : { cattleId: nextCattleId });
  }

  function changeCrop(value: string) {
    const nextCropId = value === "none" ? "" : value;
    const relation = crops.find((row) => row.id === nextCropId);
    updateForm(relation?.section_id ? { cropId: nextCropId, sectionId: relation.section_id } : { cropId: nextCropId });
  }

  async function saveTask() {
    const { editingTaskId, title, description, dueDate, priority } = form;
    if (!title.trim() || actionReadOnly) return;
    setSaving(true);
    try {
      const payload = {
        ...(editingTaskId ? { id: editingTaskId } : {}),
        title, description: description || null, dueDate: dueDate || null, priority,
        sectionId: sectionId || null, cattleId: cattleId || null, cropId: cropId || null,
      };
      const creating = !editingTaskId;
      const signature = JSON.stringify(payload);
      if (creating && (!taskAttempt.current || taskAttempt.current.signature !== signature)) {
        taskAttempt.current = { key: createIdempotencyKey(), signature };
      }
      const result = await sendJsonResult("/api/tasks", creating ? "POST" : "PUT", payload, creating && taskAttempt.current
        ? { idempotencyKey: taskAttempt.current.key }
        : undefined);
      if (!result.ok) {
        toast.error(result.error || (editingTaskId ? "No se pudo guardar la tarea. Revisá los datos e intentá de nuevo." : "No se pudo crear la tarea. Revisá los datos e intentá de nuevo."));
        return;
      }
      if (creating) taskAttempt.current = null;
      toast.success(editingTaskId ? "Tarea actualizada" : "Tarea creada");
      setSheetOpen(false);
      resetForm();
      await loadData();
    } catch {
      toast.error(editingTaskId ? "No se pudo guardar la tarea. Revisá tu conexión e intentá de nuevo." : "No se pudo crear la tarea. Revisá tu conexión e intentá de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleTask(task: Task) {
    if (actionReadOnly) return;
    const nextStatus = task.status === "completed" ? "pending" : "completed";
    const result = await sendJsonResult("/api/tasks", "PUT", { id: task.id, status: nextStatus });
    if (result.ok) {
      setTasks((current) => current.map((item) => item.id === task.id ? { ...item, status: nextStatus, completed_at: nextStatus === "completed" ? new Date().toISOString() : null } : item));
      toast.success(nextStatus === "completed" ? "Tarea completada" : "Tarea reabierta");
    } else toast.error(result.error || "No se pudo actualizar la tarea. Intentá de nuevo.");
  }

  async function deleteTask(id: string) {
    if (actionReadOnly) return;
    const result = await sendJsonResult("/api/tasks", "DELETE", { id });
    if (result.ok) { setTasks((current) => current.filter((task) => task.id !== id)); toast.success("Tarea eliminada"); }
    else toast.error(result.error || "No se pudo eliminar la tarea. Intentá de nuevo.");
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
      if (!result.ok) {
        toast.error("No se pudo descargar el calendario", { description: result.error });
      } else {
        toast.success("Calendario descargado");
      }
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

  const canCreate = !migrationRequired && !actionReadOnly && filter !== "completed" && filter !== "overdue";

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
            <Button onClick={openNewTask} disabled={migrationRequired || actionReadOnly}><Plus className="h-4 w-4" aria-hidden="true" />Nueva tarea</Button>
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
          { label: "Pendientes", value: pendingCount },
          { label: "Vencidas", value: overdueCount, tone: overdueCount > 0 ? "bad" : undefined },
          { label: "Completadas", value: completedCount },
        ]}
      />

      <section aria-label="Lista de tareas" className="space-y-3">
        <SegmentedControl label="Filtrar tareas" options={FILTER_OPTIONS} value={filter} onChange={setFilter} />

        {visibleTasks.length === 0 ? (
          <EmptyState
            icon={filter === "completed" ? CheckCircle2 : ClipboardCheck}
            title={filter === "completed" ? "Todavía no hay tareas completadas" : filter === "overdue" ? "No hay tareas vencidas" : filter === "all" ? "Todavía no hay tareas" : "No hay tareas pendientes"}
            description={offlineReadOnly ? "La agenda queda en modo lectura hasta recuperar la conexión." : permissionReadOnly ? "Tu acceso permite consultar la agenda, pero no modificar tareas." : migrationRequired ? "La agenda va a estar disponible después de aplicar la migración." : filter === "overdue" ? "Buen trabajo: no hay tareas pendientes fuera de fecha." : "Cargá tu primera tarea para no perder el próximo trabajo del campo."}
            actionLabel={canCreate ? "Crear tarea" : undefined}
            onAction={canCreate ? openNewTask : undefined}
          />
        ) : (
          <TaskList
            tasks={visibleTasks}
            focusedTaskId={focusedTaskId}
            actionReadOnly={actionReadOnly}
            onToggle={toggleTask}
            onEdit={openEditTask}
            onDelete={deleteTask}
          />
        )}
      </section>

      <TaskSheet
        open={sheetOpen}
        onOpen={() => setSheetOpen(true)}
        onRequestClose={requestSheetClose}
        form={form}
        onChange={updateForm}
        onSectionChange={changeSection}
        onCattleChange={changeCattle}
        onCropChange={changeCrop}
        contextMismatch={contextMismatch}
        onSave={saveTask}
        saveDisabled={saving || actionReadOnly || !form.title.trim() || contextMismatch}
        saving={saving}
        sections={sections}
        cattle={availableCattle}
        crops={availableCrops}
      />
      <UnsavedChangesDialog open={discardDialogOpen} onOpenChange={setDiscardDialogOpen} onDiscard={discardFormChanges} />
    </div>
  );
}

export default function TareasPage() {
  return <Suspense fallback={<LoadingPage />}><TareasPageContent /></Suspense>;
}
