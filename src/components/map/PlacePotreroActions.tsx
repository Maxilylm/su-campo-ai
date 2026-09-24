"use client";

import { useState } from "react";
import { LandPlot, MapPinned } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { notifySectionsChanged, sendJsonResult } from "@/lib/mutate";
import type { SectionFieldStatus } from "@/lib/grazing";

export interface PadronChoice {
  id: string;
  code: string;
}

const actionLink = "inline-flex items-center gap-1 rounded-sm font-medium text-primary underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring";
const selectClass = "h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

interface PlacePotreroActionsProps {
  status: SectionFieldStatus;
  padrones: PadronChoice[];
  /** Start drawing the potrero's area by hand on the map. */
  onDraw?: (status: SectionFieldStatus) => void;
  /** Called after the potrero got its area, to reload the map. */
  onPlaced?: () => void;
}

/** The two ways to give an undrawn potrero its area: draw it, or take a
 * whole padrón's outline when the potrero is the entire parcel. */
export function PlacePotreroActions({ status, padrones, onDraw, onPlaced }: PlacePotreroActionsProps) {
  // A potrero already tied to a padrón can only take that padrón's outline.
  const choices = status.padronId ? padrones.filter((padron) => padron.id === status.padronId) : padrones;
  const [choosing, setChoosing] = useState(false);
  const [padronId, setPadronId] = useState("");
  const [saving, setSaving] = useState(false);
  const selectId = `place-padron-${status.id}`;

  async function assignWholePadron() {
    const chosen = padronId || choices[0]?.id;
    if (!chosen || saving) return;
    setSaving(true);
    try {
      const result = await sendJsonResult("/api/sections/geometry", "PUT", { id: status.id, padronId: chosen, wholePadron: true });
      if (!result.ok) {
        toast.error(result.error || "No se pudo ubicar el potrero. Intentá nuevamente.");
        return;
      }
      toast.success(`${status.name} ya está en el mapa`);
      setChoosing(false);
      notifySectionsChanged();
      onPlaced?.();
    } finally {
      setSaving(false);
    }
  }

  if (choosing) {
    return (
      <form className="flex w-full flex-wrap items-center gap-2" onSubmit={(event) => { event.preventDefault(); void assignWholePadron(); }}>
        <label htmlFor={selectId} className="text-muted-foreground">Área de {status.name}:</label>
        <select id={selectId} value={padronId || choices[0]?.id || ""} onChange={(event) => setPadronId(event.target.value)} className={selectClass}>
          {choices.map((padron) => <option key={padron.id} value={padron.id}>Padrón {padron.code} completo</option>)}
        </select>
        <Button type="submit" size="xs" disabled={saving}>{saving ? "Guardando…" : "Usar"}</Button>
        <Button type="button" size="xs" variant="ghost" onClick={() => setChoosing(false)} disabled={saving}>Cancelar</Button>
      </form>
    );
  }

  return (
    <>
      {onDraw && (
        <button type="button" onClick={() => onDraw(status)} className={actionLink}>
          <MapPinned className="h-3.5 w-3.5" aria-hidden />Dibujar en el mapa
        </button>
      )}
      {choices.length > 0 && (
        <button type="button" onClick={() => { setPadronId(choices[0].id); setChoosing(true); }} className={actionLink}>
          <LandPlot className="h-3.5 w-3.5" aria-hidden />
          {choices.length === 1 ? `Usar padrón ${choices[0].code} completo` : "Usar un padrón completo"}
        </button>
      )}
    </>
  );
}
