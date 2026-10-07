"use client";

import { useState } from "react";
import { CheckCheck, MapPin, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/FormField";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { parseLocalizedNumber } from "@/lib/number";
import { safeHexColor } from "@/lib/map-labels";
import { cn } from "@/lib/utils";
import {
  WATER_POINT_KINDS, WATER_POINT_STATUSES, checkedLabel, isCheckOverdue, waterPointKindLabel, waterPointPatch, waterStatusTone,
  type WaterPoint, type WaterPointKind, type WaterPointStatus,
} from "@/lib/water-points";
import { WATER_STATUS_COLORS } from "./constants";

const TONE_SELECTED: Record<"info" | "warn" | "bad", string> = {
  info: "border-info bg-info-soft text-info",
  warn: "border-warn bg-warn-soft text-warn",
  bad: "border-bad bg-bad-soft text-bad",
};

export interface SectionChoice {
  id: string;
  name: string;
  color: string | null;
}

interface Draft {
  name: string;
  kind: WaterPointKind;
  status: WaterPointStatus;
  capacity: string;
  sectionIds: string[];
  notes: string;
}

const draftFrom = (point: WaterPoint): Draft => ({
  name: point.name,
  kind: point.kind,
  status: point.status,
  capacity: point.capacity_liters != null ? String(point.capacity_liters) : "",
  sectionIds: point.section_ids,
  notes: point.notes ?? "",
});

interface WaterPointSheetProps {
  point: WaterPoint | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sections: SectionChoice[];
  readOnly: boolean;
  saving: boolean;
  error: string;
  onSave: (id: string, patch: Record<string, unknown>) => void;
  onMarkChecked: (point: WaterPoint) => void;
  onRelocate: (point: WaterPoint) => void;
  onDelete: (point: WaterPoint) => void;
}

/** Details of one aguada: what it is, whether it has water, which potreros drink from it. */
export function WaterPointSheet({ point, open, onOpenChange, sections, readOnly, saving, error, onSave, onMarkChecked, onRelocate, onDelete }: WaterPointSheetProps) {
  // The parent remounts this component every time the sheet opens, so each
  // opening starts from the aguada as it is now; `original` is that snapshot,
  // and a save sends only what changed since (waterPointPatch).
  const [original] = useState<WaterPoint | null>(point);
  const [draft, setDraft] = useState<Draft | null>(point ? draftFrom(point) : null);
  const [capacityError, setCapacityError] = useState("");

  if (!point || !draft || !original) return null;
  const patch = (next: Partial<Draft>) => setDraft((current) => (current ? { ...current, ...next } : current));
  const toggleSection = (id: string) => patch({
    sectionIds: draft.sectionIds.includes(id) ? draft.sectionIds.filter((item) => item !== id) : [...draft.sectionIds, id],
  });
  const overdue = isCheckOverdue(point.last_checked_at);

  function save() {
    if (!original || !draft) return;
    const capacity = draft.capacity.trim() ? parseLocalizedNumber(draft.capacity) : null;
    if (capacity != null && (!Number.isFinite(capacity) || capacity < 0)) {
      setCapacityError("Escribí la capacidad en litros, por ejemplo 20000.");
      return;
    }
    setCapacityError("");
    // Ids of potreros not in the list (not loaded yet, or deleted) are kept
    // as they are: readers already ignore ids that no longer exist.
    onSave(original.id, waterPointPatch(original, {
      name: draft.name,
      kind: draft.kind,
      status: draft.status,
      capacityLiters: capacity,
      sectionIds: draft.sectionIds,
      notes: draft.notes,
    }));
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 pr-8">
            <span aria-hidden="true" className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: WATER_STATUS_COLORS[point.status] }} />
            <span className="truncate">{point.name}</span>
          </SheetTitle>
          <SheetDescription>
            {waterPointKindLabel(point.kind)} · <span className={overdue ? "text-warn" : undefined}>{checkedLabel(point.last_checked_at)}</span>
            {!point.location && " · sin ubicar en el mapa"}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 px-4">
          {!readOnly && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => onMarkChecked(point)} disabled={saving}>
                <CheckCheck aria-hidden="true" />Marcar revisada hoy
              </Button>
              <Button variant="ghost" size="sm" onClick={() => onRelocate(point)} disabled={saving}>
                <MapPin aria-hidden="true" />{point.location ? "Reubicar" : "Ubicar en el mapa"}
              </Button>
            </div>
          )}

          <fieldset className="space-y-2" disabled={readOnly}>
            <legend className="mb-2 text-sm font-medium">Estado</legend>
            <div className="grid grid-cols-2 gap-2">
              {WATER_POINT_STATUSES.map((status) => {
                const selected = draft.status === status.value;
                return (
                  <button
                    type="button"
                    key={status.value}
                    onClick={() => patch({ status: status.value })}
                    aria-pressed={selected}
                    className={cn(
                      "flex min-h-11 items-center justify-center gap-1.5 rounded-md border px-2 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
                      selected ? TONE_SELECTED[waterStatusTone(status.value)] : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                  >
                    <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: WATER_STATUS_COLORS[status.value] }} />
                    {status.label}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <FormField label="Nombre">
            <Input value={draft.name} onChange={(event) => patch({ name: event.target.value })} maxLength={120} disabled={readOnly} />
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="water-point-kind">Tipo</Label>
              <Select value={draft.kind} onValueChange={(kind) => patch({ kind: kind as WaterPointKind })} disabled={readOnly}>
                <SelectTrigger id="water-point-kind" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {WATER_POINT_KINDS.map((kind) => <SelectItem key={kind.value} value={kind.value}>{kind.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <FormField label={<>Capacidad <span className="font-normal text-muted-foreground">(litros)</span></>} className="space-y-2">
                <Input inputMode="decimal" value={draft.capacity} onChange={(event) => patch({ capacity: event.target.value })} placeholder="Opcional" disabled={readOnly} aria-invalid={capacityError ? true : undefined} />
              </FormField>
            </div>
          </div>
          {capacityError && <p role="alert" className="-mt-3 text-xs text-bad">{capacityError}</p>}

          <fieldset disabled={readOnly}>
            <legend className="mb-1 text-sm font-medium">Potreros que abastece</legend>
            <p className="mb-2 text-xs text-muted-foreground">Si la aguada está seca o rota, esos potreros aparecen sin agua en alertas y en el Plan del día.</p>
            {sections.length === 0 ? (
              <p className="text-sm text-muted-foreground">Todavía no hay potreros.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {sections.map((section) => {
                  const selected = draft.sectionIds.includes(section.id);
                  return (
                    <button
                      type="button"
                      key={section.id}
                      onClick={() => toggleSection(section.id)}
                      aria-pressed={selected}
                      className={cn(
                        "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11 disabled:opacity-50",
                        selected ? "border-info bg-info-soft text-info" : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
                      )}
                    >
                      <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: safeHexColor(section.color) }} />
                      {section.name}
                    </button>
                  );
                })}
              </div>
            )}
          </fieldset>

          <FormField label="Notas">
            <Textarea value={draft.notes} onChange={(event) => patch({ notes: event.target.value })} maxLength={2000} placeholder="Flotador, bomba, quién la revisa…" disabled={readOnly} />
          </FormField>

          {error && <p role="alert" className="rounded-md border border-bad-line bg-bad-soft px-3 py-2 text-sm text-foreground">{error}</p>}
        </div>

        <SheetFooter>
          {!readOnly && <Button onClick={save} disabled={saving || !draft.name.trim()}>{saving ? "Guardando…" : "Guardar cambios"}</Button>}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cerrar</Button>
          {!readOnly && (
            <Button variant="ghost" onClick={() => onDelete(point)} disabled={saving} className="text-bad hover:text-bad">
              <Trash2 aria-hidden="true" />Eliminar aguada
            </Button>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
