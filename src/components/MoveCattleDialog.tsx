"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { categoryLabel, suggestDestinations, type SectionFieldStatus } from "@/lib/grazing";
import { createIdempotencyKey, sendJsonResult } from "@/lib/mutate";

interface MoveCattleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: SectionFieldStatus | null;
  statuses: SectionFieldStatus[];
  /** Destination to preselect, e.g. the plan's suggestion. */
  preferredDestinationId?: string | null;
  /** Start with every batch selected, as a rotation move means the whole herd. */
  moveWholeHerd?: boolean;
  onMoved?: () => void;
}

const selectClassName = "h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground";

const ALL_BATCHES = "__all__";

/** Move head out of a potrero: one batch (optionally split) or the whole
 * herd, with the rotation's ranked destinations listed first. */
export function MoveCattleDialog({ open, onOpenChange, source, statuses, preferredDestinationId, moveWholeHerd = false, onMoved }: MoveCattleDialogProps) {
  const [batchId, setBatchId] = useState("");
  const [count, setCount] = useState("");
  const [destinationId, setDestinationId] = useState("");
  const [saving, setSaving] = useState(false);
  const attempt = useRef<{ key: string; signature: string } | null>(null);

  const batches = source?.batches ?? [];
  const wholeHerd = batchId === ALL_BATCHES;
  const batch = batches.find((item) => item.id === batchId) ?? null;
  const suggestions = source
    ? suggestDestinations(statuses, { sectionId: source.id, heads: source.heads, ug: source.ug }, undefined, 5)
    : [];
  const suggestedIds = new Set(suggestions.map((suggestion) => suggestion.sectionId));
  const others = statuses.filter((status) => status.id !== source?.id && !suggestedIds.has(status.id));

  useEffect(() => {
    if (!open || !source) return;
    const first = source.batches[0];
    const all = moveWholeHerd && source.batches.length > 1;
    setBatchId(all ? ALL_BATCHES : first?.id ?? "");
    setCount(all ? String(source.heads) : first ? String(first.count) : "");
    setDestinationId(preferredDestinationId ?? suggestions[0]?.sectionId ?? "");
    attempt.current = null;
    // Reset only when the dialog opens for a potrero, not on every refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, source?.id]);

  const parsedCount = Number(count);
  const countValid = wholeHerd || (Boolean(batch) && Number.isInteger(parsedCount) && parsedCount > 0 && parsedCount <= (batch?.count ?? 0));
  const canSubmit = countValid && Boolean(destinationId) && !saving;

  async function submit() {
    if (!canSubmit || (!batch && !wholeHerd)) return;
    const moves = wholeHerd
      ? batches.map((item) => ({ id: item.id, count: item.count }))
      : [{ id: batch!.id, count: parsedCount }];
    const signature = `${moves.map((move) => `${move.id}:${move.count}`).join(",")}:${destinationId}`;
    if (!attempt.current || attempt.current.signature !== signature) attempt.current = { key: createIdempotencyKey(), signature };
    setSaving(true);
    try {
      // One request for the whole herd; the server runs one atomic,
      // idempotent RPC per batch, so a retry never repeats a finished move.
      const result = await sendJsonResult(
        "/api/cattle/move",
        "POST",
        { sectionId: destinationId, moves: moves.map((move) => ({ cattleId: move.id, count: move.count })) },
        { idempotencyKey: attempt.current.key, timeoutMs: 25_000 },
      );
      if (!result.ok) {
        toast.error(result.error || "No se pudo mover la hacienda.");
        onMoved?.();
        return;
      }
      const moved = moves.reduce((sum, move) => sum + move.count, 0);
      const destination = statuses.find((status) => status.id === destinationId);
      toast.success(wholeHerd
        ? `Movidas ${moved} cabezas (${moves.length} lotes) a ${destination?.name ?? "destino"}`
        : `Movidas ${moved} ${categoryLabel(batch!.category, moved)} a ${destination?.name ?? "destino"}`);
      attempt.current = null;
      onOpenChange(false);
      onMoved?.();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!saving) onOpenChange(next); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Mover hacienda{source ? ` de ${source.name}` : ""}</DialogTitle>
          <DialogDescription>El potrero de origen empieza a descansar cuando queda vacío.</DialogDescription>
        </DialogHeader>

        {batches.length === 0 ? (
          <p className="text-sm text-muted-foreground">Este potrero no tiene lotes.</p>
        ) : (
          <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
            <div className="grid gap-2">
              <Label htmlFor="move-batch">Lote</Label>
              <select
                id="move-batch"
                className={selectClassName}
                value={batchId}
                onChange={(event) => {
                  setBatchId(event.target.value);
                  if (event.target.value === ALL_BATCHES) {
                    setCount(String(source?.heads ?? ""));
                    return;
                  }
                  const next = batches.find((item) => item.id === event.target.value);
                  if (next) setCount(String(next.count));
                }}
              >
                {batches.length > 1 && <option value={ALL_BATCHES}>Todo el potrero ({source?.heads} cab., {batches.length} lotes)</option>}
                {batches.map((item) => (
                  <option key={item.id} value={item.id}>{item.count} {categoryLabel(item.category, item.count)}{item.breed ? ` (${item.breed})` : ""}</option>
                ))}
              </select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="move-count">Cabezas a mover</Label>
              <Input id="move-count" inputMode="numeric" value={count} disabled={wholeHerd} onChange={(event) => setCount(event.target.value.replace(/\D/g, ""))} aria-invalid={count !== "" && !countValid} aria-describedby="move-count-hint" />
              <p id="move-count-hint" className="text-xs text-muted-foreground">
                {wholeHerd
                  ? `Se mueven todos los lotes; ${source?.name} queda libre y empieza a descansar.`
                  : batch ? (parsedCount < batch.count && countValid ? `Se divide el lote: quedan ${batch.count - parsedCount} en ${source?.name}.` : `Todo el lote (${batch.count}).`) : ""}
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="move-destination">Potrero de destino</Label>
              <select id="move-destination" className={selectClassName} value={destinationId} onChange={(event) => setDestinationId(event.target.value)}>
                <option value="" disabled>Elegí un potrero</option>
                {suggestions.length > 0 && (
                  <optgroup label="Sugeridos">
                    {suggestions.map((suggestion) => (
                      <option key={suggestion.sectionId} value={suggestion.sectionId}>{suggestion.name}{suggestion.notes.length ? ` — ${suggestion.notes.join(", ")}` : ""}</option>
                    ))}
                  </optgroup>
                )}
                {others.length > 0 && (
                  <optgroup label={suggestions.length > 0 ? "Otros potreros" : "Potreros"}>
                    {others.map((status) => (
                      <option key={status.id} value={status.id}>{status.name} — {status.summary}</option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
              <Button type="submit" disabled={!canSubmit}>{saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Mover</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
