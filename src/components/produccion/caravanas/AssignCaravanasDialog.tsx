"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CARAVANA_STATUSES, CARAVANA_STATUS_LABELS } from "@/lib/caravanas";
import { sendJsonResult } from "@/lib/mutate";
import { NONE, type LoteOption, type SectionOption } from "./types";

const KEEP = "__keep";

interface AssignProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ids: string[];
  lotes: LoteOption[];
  sections: SectionOption[];
  onDone: () => void;
}

/** Bulk: move the selected caravanas into a lote and/or potrero, or change their status. */
export function AssignCaravanasDialog(props: AssignProps) {
  // Mounted per opening, so every opening starts from "no change".
  return props.open ? <AssignCaravanasForm {...props} /> : null;
}

function AssignCaravanasForm({ open, onOpenChange, ids, lotes, sections, onDone }: AssignProps) {
  const [loteId, setLoteId] = useState(KEEP);
  const [sectionId, setSectionId] = useState(NONE);
  const [status, setStatus] = useState(KEEP);
  const [saving, setSaving] = useState(false);

  const changesLocation = loteId !== KEEP;
  const changesStatus = status !== KEEP;
  const lote = lotes.find((option) => option.id === loteId);

  async function save() {
    if (saving || (!changesLocation && !changesStatus)) return;
    setSaving(true);
    const body: Record<string, unknown> = { ids };
    if (changesLocation) {
      body.cattleId = loteId === NONE ? null : loteId;
      body.sectionId = loteId === NONE && sectionId !== NONE ? sectionId : null;
    }
    if (changesStatus) body.status = status;
    const result = await sendJsonResult("/api/caravanas", "PATCH", body);
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error || "No se pudieron actualizar las caravanas.");
      return;
    }
    toast.success(`${ids.length.toLocaleString("es-UY")} ${ids.length === 1 ? "caravana actualizada" : "caravanas actualizadas"}`);
    onOpenChange(false);
    onDone();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!saving) onOpenChange(next); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Asignar {ids.length.toLocaleString("es-UY")} {ids.length === 1 ? "caravana" : "caravanas"}</DialogTitle>
          <DialogDescription>Elegí un lote (el animal queda en el potrero del lote) o, sin lote, un potrero. También podés cambiar el estado.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="space-y-2">
            <Label htmlFor="caravanas-assign-lote">Lote</Label>
            <Select value={loteId} onValueChange={setLoteId}>
              <SelectTrigger id="caravanas-assign-lote" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={KEEP}>No cambiar ubicación</SelectItem>
                <SelectItem value={NONE}>Sin lote</SelectItem>
                {lotes.map((option) => <SelectItem key={option.id} value={option.id}>{option.label} · {option.count} cab.</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="caravanas-assign-section">Potrero</Label>
            <Select value={loteId === NONE ? sectionId : NONE} onValueChange={setSectionId} disabled={loteId !== NONE}>
              <SelectTrigger id="caravanas-assign-section" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{loteId === NONE ? "Sin potrero" : loteId === KEEP ? "Sin cambios" : "El del lote"}</SelectItem>
                {sections.map((section) => <SelectItem key={section.id} value={section.id}>{section.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {lote && <p className="text-xs text-muted-foreground">Quedan en {lote.label}.</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="caravanas-assign-status">Estado</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger id="caravanas-assign-status" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={KEEP}>No cambiar</SelectItem>
                {CARAVANA_STATUSES.map((value) => <SelectItem key={value} value={value}>{CARAVANA_STATUS_LABELS[value]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button onClick={() => void save()} disabled={saving || (!changesLocation && !changesStatus)}>{saving ? "Guardando…" : "Aplicar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
