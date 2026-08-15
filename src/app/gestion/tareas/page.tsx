"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useFarm } from "@/contexts/FarmContext";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { LoadingPage } from "@/components/LoadingPage";
import { LoadErrorState } from "@/components/LoadErrorState";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { CalendarDays, Check, CheckCircle2, ClipboardCheck, Clock3, Download, Pencil, Plus, RefreshCw, Trash2, Undo2, WifiOff } from "lucide-react";
import { createIdempotencyKey, sendJsonResult } from "@/lib/mutate";
import { filterTasks, isTaskOverdue, taskDaysUntilDue, taskRelationLinks, taskRelationMismatch, type TaskListFilter } from "@/lib/tasks";
import { fetchWithTimeout } from "@/lib/fetch";
import { downloadAuthenticatedFile } from "@/lib/download";
import { useDataChangedRefresh } from "@/lib/use-data-changed-refresh";
import { useOfflineSnapshotRefresh } from "@/lib/use-offline-snapshot-refresh";
import { isOfflineSnapshotFresh, offlineAgendaSnapshotKey, parseOfflineAgendaSnapshot } from "@/lib/offline";
import { UnsavedChangesDialog } from "@/components/UnsavedChangesDialog";
import { hasUnsavedChanges } from "@/lib/unsaved-changes";
import { useUnsavedChangesWarning } from "@/lib/use-unsaved-changes-warning";

interface Task {
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

interface OptionRow { id: string; name?: string; category?: string; count?: number; crop_type?: string; section_id?: string | null }

const PRIORITIES = [
  { value: "low", label: "Baja" },
  { value: "medium", label: "Media" },
  { value: "high", label: "Alta" },
];

interface TaskFormSnapshot {
  editingTaskId: string | null;
  title: string;
  description: string;
  dueDate: string;
  priority: string;
  sectionId: string;
  cattleId: string;
  cropId: string;
}

function taskFormSignature(form: TaskFormSnapshot): string {
  return JSON.stringify(form);
}

function dueInfo(date: string | null, status: Task["status"]): { label: string; className: string } {
  if (!date) return { label: "Sin fecha", className: "text-muted-foreground" };
  if (status === "completed") return { label: new Date(`${date}T00:00:00`).toLocaleDateString("es-UY"), className: "text-muted-foreground" };
  const due = new Date(`${date}T00:00:00`);
  const days = taskDaysUntilDue(date, new Date()) ?? 0;
  if (days < 0) return { label: `Vencida · ${due.toLocaleDateString("es-UY")}`, className: "text-red-600 dark:text-red-400" };
  if (days === 0) return { label: "Vence hoy", className: "text-amber-600 dark:text-amber-400" };
  if (days === 1) return { label: "Vence mañana", className: "text-amber-600 dark:text-amber-400" };
  return { label: due.toLocaleDateString("es-UY"), className: "text-muted-foreground" };
}

function TareasPageContent() {
  const { sections, userId, offlineMode, isOnline } = useFarm();
  const router = useRouter();
  const searchParams = useSearchParams();
  const navigationQuery = searchParams.toString();
  const readOnly = offlineMode || !isOnline;
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
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState("medium");
  const [sectionId, setSectionId] = useState("");
  const [cattleId, setCattleId] = useState("");
  const [cropId, setCropId] = useState("");
  const handledNavigationQueryRef = useRef<string | null>(null);
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null);
  const [agendaSyncedAt, setAgendaSyncedAt] = useState<string | null>(null);
  const requestId = useRef(0);
  const requestRef = useRef<AbortController | null>(null);
  const taskAttempt = useRef<{ key: string; signature: string } | null>(null);
  const formBaselineRef = useRef<string | null>(null);

  const loadData = useCallback(async () => {
    const currentRequest = ++requestId.current;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    if (offlineMode || !isOnline) {
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
  }, [isOnline, offlineMode, userId]);

  useEffect(() => {
    void loadData();
    return () => {
      requestId.current += 1;
      requestRef.current?.abort();
    };
  }, [loadData]);
  useDataChangedRefresh(loadData, !readOnly);
  useOfflineSnapshotRefresh(loadData, userId, readOnly);

  useEffect(() => {
    if (!loaded || handledNavigationQueryRef.current === navigationQuery) return;
    const params = new URLSearchParams(navigationQuery);
    const taskId = params.get("taskId");
    if (params.get("new") === "1" && params.get("title") && !migrationRequired) {
      const nextForm: TaskFormSnapshot = {
        editingTaskId: null,
        title: params.get("title") || "",
        description: params.get("description") || "",
        dueDate: params.get("dueDate") || "",
        priority: params.get("priority") === "high" ? "high" : "medium",
        sectionId: params.get("sectionId") || "",
        cattleId: params.get("cattleId") || "",
        cropId: params.get("cropId") || "",
      };
      setEditingTaskId(null);
      setTitle(nextForm.title);
      setDescription(nextForm.description);
      setDueDate(nextForm.dueDate);
      setPriority(nextForm.priority);
      setSectionId(nextForm.sectionId);
      setCattleId(nextForm.cattleId);
      setCropId(nextForm.cropId);
      formBaselineRef.current = taskFormSignature(nextForm);
      setSheetOpen(true);
    }
    if (taskId && tasks.some((task) => task.id === taskId)) {
      setFilter("all");
      setFocusedTaskId(taskId);
    }
    handledNavigationQueryRef.current = navigationQuery;
    if (navigationQuery) router.replace(window.location.pathname, { scroll: false });
  }, [loaded, migrationRequired, navigationQuery, router, tasks]);

  const visibleTasks = useMemo(
    () => filterTasks(tasks, filter),
    [tasks, filter],
  );
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
    setTitle(""); setDescription(""); setDueDate(""); setPriority("medium");
    setSectionId(""); setCattleId(""); setCropId("");
  }

  function openNewTask() {
    const nextForm: TaskFormSnapshot = {
      editingTaskId: null,
      title: "",
      description: "",
      dueDate: "",
      priority: "medium",
      sectionId: "",
      cattleId: "",
      cropId: "",
    };
    resetForm();
    setEditingTaskId(null);
    formBaselineRef.current = taskFormSignature(nextForm);
    setSheetOpen(true);
  }

  function openEditTask(task: Task) {
    const nextForm: TaskFormSnapshot = {
      editingTaskId: task.id,
      title: task.title,
      description: task.description || "",
      dueDate: task.due_date || "",
      priority: task.priority,
      sectionId: task.section_id || "",
      cattleId: task.cattle_id || "",
      cropId: task.crop_id || "",
    };
    setEditingTaskId(nextForm.editingTaskId);
    setTitle(nextForm.title);
    setDescription(nextForm.description);
    setDueDate(nextForm.dueDate);
    setPriority(nextForm.priority);
    setSectionId(nextForm.sectionId);
    setCattleId(nextForm.cattleId);
    setCropId(nextForm.cropId);
    formBaselineRef.current = taskFormSignature(nextForm);
    setSheetOpen(true);
  }

  function currentFormSignature(): string {
    return taskFormSignature({ editingTaskId, title, description, dueDate, priority, sectionId, cattleId, cropId });
  }

  useUnsavedChangesWarning(sheetOpen && hasUnsavedChanges(formBaselineRef.current, currentFormSignature()));

  function discardFormChanges() {
    setDiscardDialogOpen(false);
    setSheetOpen(false);
    resetForm();
    setEditingTaskId(null);
  }

  function requestSheetClose() {
    if (saving) return;
    if (hasUnsavedChanges(formBaselineRef.current, currentFormSignature())) {
      setDiscardDialogOpen(true);
      return;
    }
    setSheetOpen(false);
    resetForm();
    setEditingTaskId(null);
  }

  function changeSection(value: string) {
    const nextSectionId = value === "none" ? "" : value;
    setSectionId(nextSectionId);
    if (!nextSectionId) return;
    setCattleId((current) => {
      const relation = cattle.find((row) => row.id === current);
      return relation?.section_id && relation.section_id !== nextSectionId ? "" : current;
    });
    setCropId((current) => {
      const relation = crops.find((row) => row.id === current);
      return relation?.section_id && relation.section_id !== nextSectionId ? "" : current;
    });
  }

  function changeCattle(value: string) {
    const nextCattleId = value === "none" ? "" : value;
    setCattleId(nextCattleId);
    const relation = cattle.find((row) => row.id === nextCattleId);
    if (relation?.section_id) setSectionId(relation.section_id);
  }

  function changeCrop(value: string) {
    const nextCropId = value === "none" ? "" : value;
    setCropId(nextCropId);
    const relation = crops.find((row) => row.id === nextCropId);
    if (relation?.section_id) setSectionId(relation.section_id);
  }

  async function saveTask() {
    if (!title.trim() || readOnly) return;
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
        toast.error(result.error || (editingTaskId ? "No se pudo guardar la tarea" : "No se pudo crear la tarea"));
        return;
      }
      if (creating) taskAttempt.current = null;
      toast.success(editingTaskId ? "Tarea actualizada" : "Tarea creada");
      setSheetOpen(false);
      resetForm();
      setEditingTaskId(null);
      await loadData();
    } catch {
      toast.error(editingTaskId ? "No se pudo guardar la tarea" : "No se pudo crear la tarea");
    } finally {
      setSaving(false);
    }
  }

  async function toggleTask(task: Task) {
    if (readOnly) return;
    const nextStatus = task.status === "completed" ? "pending" : "completed";
    const result = await sendJsonResult("/api/tasks", "PUT", { id: task.id, status: nextStatus });
    if (result.ok) {
      setTasks((current) => current.map((item) => item.id === task.id ? { ...item, status: nextStatus, completed_at: nextStatus === "completed" ? new Date().toISOString() : null } : item));
      toast.success(nextStatus === "completed" ? "Tarea completada" : "Tarea reabierta");
    } else toast.error(result.error || "No se pudo actualizar la tarea");
  }

  async function deleteTask(id: string) {
    if (readOnly) return;
    const result = await sendJsonResult("/api/tasks", "DELETE", { id });
    if (result.ok) { setTasks((current) => current.filter((task) => task.id !== id)); toast.success("Tarea eliminada"); }
    else toast.error(result.error || "No se pudo eliminar la tarea");
  }

  async function refresh() {
    setRefreshing(true);
    try { await loadData(); } finally { setRefreshing(false); }
  }

  async function downloadCalendar() {
    if (readOnly || calendarDownloading) return;
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
  if (loadError) return <LoadErrorState title="No se pudo cargar la agenda" description={loadError} onRetry={loadData} />;

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: "Gestión", href: "/gestion/inventario" }, { label: "Tareas" }]}
        title="Agenda de tareas"
        description="Organizá el trabajo y vinculalo al lugar, lote o cultivo correspondiente."
        actions={<div className="flex flex-wrap gap-2"><Button variant="outline" onClick={refresh} disabled={refreshing || readOnly}><RefreshCw className={`mr-1.5 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />Actualizar</Button>{migrationRequired || readOnly ? <Button variant="outline" disabled title={readOnly ? "Necesitás conexión para descargarlo" : undefined}><Download className="mr-1.5 h-4 w-4" />Exportar CSV</Button> : <Button variant="outline" asChild><a href="/api/export?format=csv&table=tasks" download="campoai-tareas.csv"><Download className="mr-1.5 h-4 w-4" />Exportar CSV</a></Button>}{readOnly ? <Button variant="outline" disabled title="Necesitás conexión para descargarlo"><CalendarDays className="mr-1.5 h-4 w-4" />Calendario</Button> : <Button variant="outline" onClick={() => void downloadCalendar()} disabled={calendarDownloading}><CalendarDays className="mr-1.5 h-4 w-4" />{calendarDownloading ? "Descargando…" : "Calendario"}</Button>}<Button onClick={openNewTask} disabled={migrationRequired || readOnly}><Plus className="mr-1.5 h-4 w-4" />Nueva tarea</Button></div>}
      />

      {readOnly && agendaSyncedAt && (
        <Alert role="status">
          <WifiOff className="h-4 w-4" />
          <AlertTitle>Agenda en modo lectura</AlertTitle>
          <AlertDescription>
            Mostrando la última agenda sincronizada el {new Date(agendaSyncedAt).toLocaleString("es-UY")}.
            Los cambios se habilitarán al recuperar la conexión.
          </AlertDescription>
        </Alert>
      )}

      {migrationRequired && (
        <Alert>
          <ClipboardCheck className="h-4 w-4" />
          <AlertTitle>La agenda necesita una actualización de Supabase</AlertTitle>
          <AlertDescription>Aplicá <code>supabase/014_tasks.sql</code> en el SQL Editor para activar el guardado de tareas.</AlertDescription>
        </Alert>
      )}

      {tasksTruncated && (
        <Alert>
          <AlertDescription>
            Se muestran solo las 500 tareas más recientes. Para consultar la agenda completa, descargá Tareas CSV: <a href="/api/export?format=csv&table=tasks" className="font-medium text-primary underline-offset-2 hover:underline">Descargar Tareas CSV</a>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-4"><p className="text-xs text-muted-foreground">Pendientes</p><p className="mt-1 text-2xl font-semibold tabular-nums">{pendingCount}</p></div>
        <div className="rounded-xl border border-red-500/25 bg-card p-4"><p className="text-xs text-muted-foreground">Vencidas</p><p className="mt-1 text-2xl font-semibold tabular-nums text-red-600 dark:text-red-400">{overdueCount}</p></div>
        <div className="col-span-2 rounded-xl border border-emerald-500/25 bg-card p-4 sm:col-span-1"><p className="text-xs text-muted-foreground">Completadas</p><p className="mt-1 text-2xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{tasks.filter((task) => task.status === "completed").length}</p></div>
      </div>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filtrar tareas">
        {([{ value: "pending", label: "Pendientes" }, { value: "overdue", label: "Vencidas" }, { value: "all", label: "Todas" }, { value: "completed", label: "Completadas" }] as const).map((option) => (
          <Button key={option.value} size="sm" variant={filter === option.value ? "secondary" : "outline"} onClick={() => setFilter(option.value)}>{option.label}</Button>
        ))}
      </div>

      {visibleTasks.length === 0 ? (
        <div className="rounded-xl border border-border bg-card"><EmptyState icon={filter === "completed" ? CheckCircle2 : ClipboardCheck} title={filter === "completed" ? "Todavía no hay tareas completadas" : filter === "overdue" ? "No hay tareas vencidas" : filter === "all" ? "Todavía no hay tareas" : "No hay tareas pendientes"} description={readOnly ? "La agenda queda en modo lectura hasta recuperar la conexión." : migrationRequired ? "La agenda estará disponible después de aplicar la migración." : filter === "overdue" ? "Buen trabajo: no hay tareas pendientes fuera de fecha." : "Creá una tarea para no perder el próximo trabajo del campo."} actionLabel={!migrationRequired && !readOnly && filter !== "completed" && filter !== "overdue" ? "Crear tarea" : undefined} onAction={!migrationRequired && !readOnly && filter !== "completed" && filter !== "overdue" ? openNewTask : undefined} /></div>
      ) : (
        <div className="space-y-2">
          {visibleTasks.map((task) => {
            const due = dueInfo(task.due_date, task.status);
            const relations = taskRelationLinks(task);
            return (
              <div id={`task-${task.id}`} key={task.id} className={`flex items-start gap-3 rounded-xl border bg-card p-4 transition-colors ${focusedTaskId === task.id ? "border-primary ring-2 ring-primary/20" : task.status === "completed" ? "border-border opacity-70" : task.priority === "high" ? "border-red-500/30" : "border-border"}`}>
                <button type="button" onClick={() => toggleTask(task)} disabled={readOnly} aria-label={task.status === "completed" ? "Reabrir tarea" : "Completar tarea"} className="mt-0.5 shrink-0 rounded-full text-muted-foreground hover:text-primary disabled:cursor-not-allowed disabled:opacity-50">{task.status === "completed" ? <CheckCircle2 className="h-5 w-5 text-emerald-500" /> : <span className="block h-5 w-5 rounded-full border-2 border-muted-foreground/50" />}</button>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><span className={`font-medium ${task.status === "completed" ? "line-through" : ""}`}>{task.title}</span><Badge variant="outline" className={task.priority === "high" ? "border-red-500/30 text-red-600 dark:text-red-400" : task.priority === "low" ? "text-muted-foreground" : "border-amber-500/30 text-amber-600 dark:text-amber-400"}>{PRIORITIES.find((item) => item.value === task.priority)?.label}</Badge></div>
                  {task.description && <p className="mt-1 text-sm text-muted-foreground">{task.description}</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"><span className={`flex items-center gap-1 ${due.className}`}><Clock3 className="h-3.5 w-3.5" />{due.label}</span>{relations.length > 0 && <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">{relations.map((relation, index) => <span key={relation.label} className="inline-flex items-center gap-2">{index > 0 && <span aria-hidden="true">·</span>}{relation.href ? <Link href={relation.href} className="text-primary hover:underline">{relation.label}</Link> : relation.label}</span>)}</span>}</div>
                </div>
                <div className="flex shrink-0 gap-1"><Button variant="ghost" size="icon" onClick={() => openEditTask(task)} disabled={readOnly} aria-label="Editar tarea"><Pencil className="h-4 w-4" /></Button><Button variant="ghost" size="icon" onClick={() => toggleTask(task)} disabled={readOnly} aria-label={task.status === "completed" ? "Reabrir" : "Completar"}>{task.status === "completed" ? <Undo2 className="h-4 w-4" /> : <Check className="h-4 w-4" />}</Button><ConfirmDialog trigger={<Button variant="ghost" size="icon" disabled={readOnly} aria-label="Eliminar tarea"><Trash2 className="h-4 w-4 text-muted-foreground" /></Button>} title="¿Eliminar tarea?" description="Esta acción no se puede deshacer." onConfirm={() => deleteTask(task.id)} /></div>
              </div>
            );
          })}
        </div>
      )}

      <Sheet open={sheetOpen} onOpenChange={(open) => { if (open) setSheetOpen(true); else requestSheetClose(); }}>
        <SheetContent className="overflow-y-auto"><SheetHeader><SheetTitle>{editingTaskId ? "Editar tarea" : "Nueva tarea"}</SheetTitle><SheetDescription>Agregá el próximo trabajo y, si querés, vinculalo a una entidad del campo.</SheetDescription></SheetHeader><div className="grid gap-4 px-4 py-4">
          <div className="grid gap-2"><Label htmlFor="task-title">Título</Label><Input id="task-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ej: Revisar alambrado del Norte" maxLength={160} /></div>
          <div className="grid gap-2"><Label htmlFor="task-description">Descripción <span className="text-muted-foreground">(opcional)</span></Label><Textarea id="task-description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Detalles, materiales o indicaciones" maxLength={2000} /></div>
          <div className="grid grid-cols-2 gap-3"><div className="grid gap-2"><Label htmlFor="task-date">Vencimiento</Label><Input id="task-date" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></div><div className="grid gap-2"><Label>Prioridad</Label><Select value={priority} onValueChange={setPriority}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{PRIORITIES.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select></div></div>
          <div className="grid gap-2"><Label>Sección <span className="text-muted-foreground">(opcional)</span></Label><Select value={sectionId || "none"} onValueChange={changeSection}><SelectTrigger><SelectValue placeholder="Sin sección" /></SelectTrigger><SelectContent><SelectItem value="none">Sin sección</SelectItem>{sections.map((section) => <SelectItem key={section.id} value={section.id}>{section.name}</SelectItem>)}</SelectContent></Select></div>
          <div className="grid gap-2"><Label>Hacienda <span className="text-muted-foreground">(opcional)</span></Label><Select value={cattleId || "none"} onValueChange={changeCattle}><SelectTrigger><SelectValue placeholder="Sin lote" /></SelectTrigger><SelectContent><SelectItem value="none">Sin lote</SelectItem>{availableCattle.map((row) => <SelectItem key={row.id} value={row.id}>{row.category} · {row.count} cabezas</SelectItem>)}</SelectContent></Select></div>
          <div className="grid gap-2"><Label>Cultivo <span className="text-muted-foreground">(opcional)</span></Label><Select value={cropId || "none"} onValueChange={changeCrop}><SelectTrigger><SelectValue placeholder="Sin cultivo" /></SelectTrigger><SelectContent><SelectItem value="none">Sin cultivo</SelectItem>{availableCrops.map((row) => <SelectItem key={row.id} value={row.id}>{row.crop_type}</SelectItem>)}</SelectContent></Select></div>
          {contextMismatch && <p className="text-sm text-destructive">La sección elegida no coincide con la hacienda o el cultivo. Elegí otra relación antes de guardar.</p>}
        </div><SheetFooter><Button variant="outline" onClick={requestSheetClose} disabled={saving}>Cancelar</Button><Button onClick={saveTask} disabled={saving || readOnly || !title.trim() || contextMismatch}>{saving ? "Guardando…" : editingTaskId ? "Guardar cambios" : "Crear tarea"}</Button></SheetFooter></SheetContent>
      </Sheet>
      <UnsavedChangesDialog open={discardDialogOpen} onOpenChange={setDiscardDialogOpen} onDiscard={discardFormChanges} />
    </div>
  );
}

export default function TareasPage() {
  return <Suspense fallback={<LoadingPage />}><TareasPageContent /></Suspense>;
}
