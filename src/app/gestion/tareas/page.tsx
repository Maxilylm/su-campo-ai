"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
import { Check, CheckCircle2, ClipboardCheck, Clock3, Plus, RefreshCw, Trash2, Undo2 } from "lucide-react";
import { sendJson } from "@/lib/mutate";
import { isTaskOverdue, taskDaysUntilDue } from "@/lib/tasks";

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

interface OptionRow { id: string; name?: string; category?: string; count?: number; crop_type?: string }

const PRIORITIES = [
  { value: "low", label: "Baja" },
  { value: "medium", label: "Media" },
  { value: "high", label: "Alta" },
];

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

function relationLabel(task: Task): string | null {
  if (task.sections?.name) return `Sección: ${task.sections.name}`;
  if (task.cattle) return `Hacienda: ${task.cattle.category} (${task.cattle.count})`;
  if (task.crops?.crop_type) return `Cultivo: ${task.crops.crop_type}`;
  return null;
}

export default function TareasPage() {
  const { sections } = useFarm();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [cattle, setCattle] = useState<OptionRow[]>([]);
  const [crops, setCrops] = useState<OptionRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [migrationRequired, setMigrationRequired] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<"pending" | "completed" | "all">("pending");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState("medium");
  const [sectionId, setSectionId] = useState("");
  const [cattleId, setCattleId] = useState("");
  const [cropId, setCropId] = useState("");

  const loadData = useCallback(async () => {
    setLoadError(false);
    try {
      const [taskRes, cattleRes, cropRes] = await Promise.all([
        fetch("/api/tasks"),
        fetch("/api/cattle"),
        fetch("/api/crops"),
      ]);
      if (!taskRes.ok || !cattleRes.ok || !cropRes.ok) throw new Error("tasks request failed");
      const taskPayload = await taskRes.json();
      setTasks(Array.isArray(taskPayload.tasks) ? taskPayload.tasks : []);
      setMigrationRequired(taskPayload.migrationRequired === true);
      setCattle(await cattleRes.json());
      setCrops(await cropRes.json());
    } catch (error) {
      console.error("Load tasks error:", error);
      setLoadError(true);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const visibleTasks = useMemo(
    () => tasks.filter((task) => filter === "all" || task.status === filter),
    [tasks, filter],
  );
  const pendingCount = tasks.filter((task) => task.status === "pending").length;
  const overdueCount = tasks.filter((task) => isTaskOverdue(task.due_date, task.status)).length;

  function resetForm() {
    setTitle(""); setDescription(""); setDueDate(""); setPriority("medium");
    setSectionId(""); setCattleId(""); setCropId("");
  }

  function openNewTask() {
    resetForm();
    setSheetOpen(true);
  }

  async function createTask() {
    if (!title.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title, description: description || null, dueDate: dueDate || null, priority,
          sectionId: sectionId || null, cattleId: cattleId || null, cropId: cropId || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error || "No se pudo crear la tarea");
        return;
      }
      toast.success("Tarea creada");
      setSheetOpen(false);
      await loadData();
    } finally {
      setSaving(false);
    }
  }

  async function toggleTask(task: Task) {
    const nextStatus = task.status === "completed" ? "pending" : "completed";
    const ok = await sendJson("/api/tasks", "PUT", { id: task.id, status: nextStatus });
    if (ok) {
      setTasks((current) => current.map((item) => item.id === task.id ? { ...item, status: nextStatus, completed_at: nextStatus === "completed" ? new Date().toISOString() : null } : item));
      toast.success(nextStatus === "completed" ? "Tarea completada" : "Tarea reabierta");
    } else toast.error("No se pudo actualizar la tarea");
  }

  async function deleteTask(id: string) {
    const ok = await sendJson("/api/tasks", "DELETE", { id });
    if (ok) { setTasks((current) => current.filter((task) => task.id !== id)); toast.success("Tarea eliminada"); }
    else toast.error("No se pudo eliminar la tarea");
  }

  async function refresh() {
    setRefreshing(true);
    try { await loadData(); } finally { setRefreshing(false); }
  }

  if (!loaded) return <LoadingPage />;
  if (loadError) return <LoadErrorState title="No se pudo cargar la agenda" onRetry={loadData} />;

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: "Gestión", href: "/gestion/inventario" }, { label: "Tareas" }]}
        title="Agenda de tareas"
        description="Organizá el trabajo y vinculalo al lugar, lote o cultivo correspondiente."
        actions={<div className="flex gap-2"><Button variant="outline" onClick={refresh} disabled={refreshing}><RefreshCw className={`mr-1.5 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />Actualizar</Button><Button onClick={openNewTask} disabled={migrationRequired}><Plus className="mr-1.5 h-4 w-4" />Nueva tarea</Button></div>}
      />

      {migrationRequired && (
        <Alert>
          <ClipboardCheck className="h-4 w-4" />
          <AlertTitle>La agenda necesita una actualización de Supabase</AlertTitle>
          <AlertDescription>Aplicá <code>supabase/014_tasks.sql</code> en el SQL Editor para activar el guardado de tareas.</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-4"><p className="text-xs text-muted-foreground">Pendientes</p><p className="mt-1 text-2xl font-semibold tabular-nums">{pendingCount}</p></div>
        <div className="rounded-xl border border-red-500/25 bg-card p-4"><p className="text-xs text-muted-foreground">Vencidas</p><p className="mt-1 text-2xl font-semibold tabular-nums text-red-600 dark:text-red-400">{overdueCount}</p></div>
        <div className="col-span-2 rounded-xl border border-emerald-500/25 bg-card p-4 sm:col-span-1"><p className="text-xs text-muted-foreground">Completadas</p><p className="mt-1 text-2xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{tasks.filter((task) => task.status === "completed").length}</p></div>
      </div>

      <div className="flex gap-2">
        {([{ value: "pending", label: "Pendientes" }, { value: "all", label: "Todas" }, { value: "completed", label: "Completadas" }] as const).map((option) => (
          <Button key={option.value} size="sm" variant={filter === option.value ? "secondary" : "outline"} onClick={() => setFilter(option.value)}>{option.label}</Button>
        ))}
      </div>

      {visibleTasks.length === 0 ? (
        <div className="rounded-xl border border-border bg-card"><EmptyState icon={filter === "completed" ? CheckCircle2 : ClipboardCheck} title={filter === "completed" ? "Todavía no hay tareas completadas" : "No hay tareas pendientes"} description={migrationRequired ? "La agenda estará disponible después de aplicar la migración." : "Creá una tarea para no perder el próximo trabajo del campo."} actionLabel={!migrationRequired ? "Crear tarea" : undefined} onAction={!migrationRequired ? openNewTask : undefined} /></div>
      ) : (
        <div className="space-y-2">
          {visibleTasks.map((task) => {
            const due = dueInfo(task.due_date, task.status);
            const relation = relationLabel(task);
            return (
              <div key={task.id} className={`flex items-start gap-3 rounded-xl border bg-card p-4 ${task.status === "completed" ? "border-border opacity-70" : task.priority === "high" ? "border-red-500/30" : "border-border"}`}>
                <button onClick={() => toggleTask(task)} aria-label={task.status === "completed" ? "Reabrir tarea" : "Completar tarea"} className="mt-0.5 shrink-0 rounded-full text-muted-foreground hover:text-primary">{task.status === "completed" ? <CheckCircle2 className="h-5 w-5 text-emerald-500" /> : <span className="block h-5 w-5 rounded-full border-2 border-muted-foreground/50" />}</button>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><span className={`font-medium ${task.status === "completed" ? "line-through" : ""}`}>{task.title}</span><Badge variant="outline" className={task.priority === "high" ? "border-red-500/30 text-red-600 dark:text-red-400" : task.priority === "low" ? "text-muted-foreground" : "border-amber-500/30 text-amber-600 dark:text-amber-400"}>{PRIORITIES.find((item) => item.value === task.priority)?.label}</Badge></div>
                  {task.description && <p className="mt-1 text-sm text-muted-foreground">{task.description}</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"><span className={`flex items-center gap-1 ${due.className}`}><Clock3 className="h-3.5 w-3.5" />{due.label}</span>{relation && <span className="text-muted-foreground">{relation}</span>}</div>
                </div>
                <div className="flex shrink-0 gap-1"><Button variant="ghost" size="icon" onClick={() => toggleTask(task)} aria-label={task.status === "completed" ? "Reabrir" : "Completar"}>{task.status === "completed" ? <Undo2 className="h-4 w-4" /> : <Check className="h-4 w-4" />}</Button><ConfirmDialog trigger={<Button variant="ghost" size="icon" aria-label="Eliminar tarea"><Trash2 className="h-4 w-4 text-muted-foreground" /></Button>} title="¿Eliminar tarea?" description="Esta acción no se puede deshacer." onConfirm={() => deleteTask(task.id)} /></div>
              </div>
            );
          })}
        </div>
      )}

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="overflow-y-auto"><SheetHeader><SheetTitle>Nueva tarea</SheetTitle><SheetDescription>Agregá el próximo trabajo y, si querés, vinculalo a una entidad del campo.</SheetDescription></SheetHeader><div className="grid gap-4 px-4 py-4">
          <div className="grid gap-2"><Label htmlFor="task-title">Título</Label><Input id="task-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ej: Revisar alambrado del Norte" maxLength={160} /></div>
          <div className="grid gap-2"><Label htmlFor="task-description">Descripción <span className="text-muted-foreground">(opcional)</span></Label><Textarea id="task-description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Detalles, materiales o indicaciones" maxLength={2000} /></div>
          <div className="grid grid-cols-2 gap-3"><div className="grid gap-2"><Label htmlFor="task-date">Vencimiento</Label><Input id="task-date" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></div><div className="grid gap-2"><Label>Prioridad</Label><Select value={priority} onValueChange={setPriority}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{PRIORITIES.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select></div></div>
          <div className="grid gap-2"><Label>Sección <span className="text-muted-foreground">(opcional)</span></Label><Select value={sectionId || "none"} onValueChange={(value) => setSectionId(value === "none" ? "" : value)}><SelectTrigger><SelectValue placeholder="Sin sección" /></SelectTrigger><SelectContent><SelectItem value="none">Sin sección</SelectItem>{sections.map((section) => <SelectItem key={section.id} value={section.id}>{section.name}</SelectItem>)}</SelectContent></Select></div>
          <div className="grid gap-2"><Label>Hacienda <span className="text-muted-foreground">(opcional)</span></Label><Select value={cattleId || "none"} onValueChange={(value) => setCattleId(value === "none" ? "" : value)}><SelectTrigger><SelectValue placeholder="Sin lote" /></SelectTrigger><SelectContent><SelectItem value="none">Sin lote</SelectItem>{cattle.map((row) => <SelectItem key={row.id} value={row.id}>{row.category} · {row.count} cabezas</SelectItem>)}</SelectContent></Select></div>
          <div className="grid gap-2"><Label>Cultivo <span className="text-muted-foreground">(opcional)</span></Label><Select value={cropId || "none"} onValueChange={(value) => setCropId(value === "none" ? "" : value)}><SelectTrigger><SelectValue placeholder="Sin cultivo" /></SelectTrigger><SelectContent><SelectItem value="none">Sin cultivo</SelectItem>{crops.map((row) => <SelectItem key={row.id} value={row.id}>{row.crop_type}</SelectItem>)}</SelectContent></Select></div>
        </div><SheetFooter><Button variant="outline" onClick={() => setSheetOpen(false)}>Cancelar</Button><Button onClick={createTask} disabled={saving || !title.trim()}>{saving ? "Guardando…" : "Crear tarea"}</Button></SheetFooter></SheetContent>
      </Sheet>
    </div>
  );
}
