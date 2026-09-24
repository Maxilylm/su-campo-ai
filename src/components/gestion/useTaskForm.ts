"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { createIdempotencyKey, sendJsonResult } from "@/lib/mutate";
import { taskRelationMismatch } from "@/lib/tasks";
import { hasUnsavedChanges } from "@/lib/unsaved-changes";
import { useUnsavedChangesWarning } from "@/lib/use-unsaved-changes-warning";
import { EMPTY_TASK_FORM, taskFormSignature, type Task, type TaskFormState, type TaskOptionRow } from "./task-types";

/** The create/edit sheet: its form, relation narrowing, unsaved-changes guard
 * and the idempotent save. */
export function useTaskForm({ cattle, crops, actionReadOnly, assigneeAvailable, onSaved }: {
  cattle: TaskOptionRow[];
  crops: TaskOptionRow[];
  actionReadOnly: boolean;
  /** Migration 053 applied: send assignedTo. */
  assigneeAvailable: boolean;
  onSaved: () => Promise<void>;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<TaskFormState>(EMPTY_TASK_FORM);
  const taskAttempt = useRef<{ key: string; signature: string } | null>(null);
  const formBaselineRef = useRef<string | null>(null);

  const updateForm = (patch: Partial<TaskFormState>) => setForm((current) => ({ ...current, ...patch }));

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

  function resetForm() {
    formBaselineRef.current = null;
    setForm(EMPTY_TASK_FORM);
  }

  function openForm(next: TaskFormState) {
    setForm(next);
    formBaselineRef.current = taskFormSignature(next);
    setSheetOpen(true);
  }

  function openNewTask(prefill: Partial<TaskFormState> = {}) {
    if (actionReadOnly) return;
    openForm({ ...EMPTY_TASK_FORM, ...prefill, editingTaskId: null });
  }

  function openEditTask(task: Task) {
    if (actionReadOnly) return;
    openForm({
      editingTaskId: task.id,
      title: task.title,
      description: task.description || "",
      dueDate: task.due_date || "",
      priority: task.priority,
      sectionId: task.section_id || "",
      cattleId: task.cattle_id || "",
      cropId: task.crop_id || "",
      assignedTo: task.assigned_to || "",
    });
  }

  const dirty = sheetOpen && hasUnsavedChanges(formBaselineRef.current, taskFormSignature(form));
  useUnsavedChangesWarning(dirty);

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
    const { editingTaskId, title, description, dueDate, priority, assignedTo } = form;
    if (!title.trim() || actionReadOnly) return;
    setSaving(true);
    try {
      const payload = {
        ...(editingTaskId ? { id: editingTaskId } : {}),
        title, description: description || null, dueDate: dueDate || null, priority,
        sectionId: sectionId || null, cattleId: cattleId || null, cropId: cropId || null,
        // Before 053 the column does not exist; never send it then.
        ...(assigneeAvailable && (editingTaskId || assignedTo) ? { assignedTo: assignedTo || null } : {}),
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
      await onSaved();
    } catch {
      toast.error(editingTaskId ? "No se pudo guardar la tarea. Revisá tu conexión e intentá de nuevo." : "No se pudo crear la tarea. Revisá tu conexión e intentá de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  return {
    form, updateForm, sheetOpen, setSheetOpen, discardDialogOpen, setDiscardDialogOpen, saving,
    contextMismatch, availableCattle, availableCrops,
    openNewTask, openEditTask, requestSheetClose, discardFormChanges,
    changeSection, changeCattle, changeCrop, saveTask,
  };
}
