"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { TASK_PRIORITIES, type TaskFormState, type TaskOptionRow } from "./task-types";

const OPTIONAL = <span className="font-normal text-muted-foreground">(opcional)</span>;

export function TaskSheet({
  open, onOpen, onRequestClose, form, onChange, onSectionChange, onCattleChange, onCropChange,
  contextMismatch, onSave, saveDisabled, saving, sections, cattle, crops,
}: {
  open: boolean;
  onOpen: () => void;
  onRequestClose: () => void;
  form: TaskFormState;
  onChange: (patch: Partial<TaskFormState>) => void;
  onSectionChange: (value: string) => void;
  onCattleChange: (value: string) => void;
  onCropChange: (value: string) => void;
  contextMismatch: boolean;
  onSave: () => void;
  saveDisabled: boolean;
  saving: boolean;
  sections: { id: string; name: string }[];
  /** Cattle and crops already narrowed to the chosen section. */
  cattle: TaskOptionRow[];
  crops: TaskOptionRow[];
}) {
  return (
    <Sheet open={open} onOpenChange={(next) => { if (next) onOpen(); else onRequestClose(); }}>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{form.editingTaskId ? "Editar tarea" : "Nueva tarea"}</SheetTitle>
          <SheetDescription>Agregá el próximo trabajo y, si querés, vinculalo a un potrero, lote o cultivo.</SheetDescription>
        </SheetHeader>
        <div className="grid gap-4 px-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="task-title">Título</Label>
            <Input id="task-title" value={form.title} onChange={(event) => onChange({ title: event.target.value })} placeholder="Ej: Revisar alambrado del Norte" maxLength={160} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="task-description">Descripción {OPTIONAL}</Label>
            <Textarea id="task-description" value={form.description} onChange={(event) => onChange({ description: event.target.value })} placeholder="Detalles, materiales o indicaciones" maxLength={2000} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="task-date">Vencimiento</Label>
              <Input id="task-date" type="date" value={form.dueDate} onChange={(event) => onChange({ dueDate: event.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="task-priority">Prioridad</Label>
              <Select value={form.priority} onValueChange={(priority) => onChange({ priority })}>
                <SelectTrigger id="task-priority" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{TASK_PRIORITIES.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="task-section">Sección {OPTIONAL}</Label>
            <Select value={form.sectionId || "none"} onValueChange={onSectionChange}>
              <SelectTrigger id="task-section" className="w-full"><SelectValue placeholder="Sin sección" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sin sección</SelectItem>
                {sections.map((section) => <SelectItem key={section.id} value={section.id}>{section.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="task-cattle">Hacienda {OPTIONAL}</Label>
            <Select value={form.cattleId || "none"} onValueChange={onCattleChange}>
              <SelectTrigger id="task-cattle" className="w-full"><SelectValue placeholder="Sin lote" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sin lote</SelectItem>
                {cattle.map((row) => <SelectItem key={row.id} value={row.id}>{row.category} · {row.count} cabezas</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="task-crop">Cultivo {OPTIONAL}</Label>
            <Select value={form.cropId || "none"} onValueChange={onCropChange}>
              <SelectTrigger id="task-crop" className="w-full"><SelectValue placeholder="Sin cultivo" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sin cultivo</SelectItem>
                {crops.map((row) => <SelectItem key={row.id} value={row.id}>{row.crop_type}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {contextMismatch && <p role="alert" className="text-sm text-bad">La sección elegida no coincide con la hacienda o el cultivo. Elegí otra relación antes de guardar.</p>}
        </div>
        <SheetFooter>
          <Button onClick={onSave} disabled={saveDisabled}>{saving ? "Guardando…" : form.editingTaskId ? "Guardar cambios" : "Crear tarea"}</Button>
          <Button variant="outline" onClick={onRequestClose} disabled={saving}>Cancelar</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
