"use client";

import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SNIG_PORTAL_URL, normalizeDicose } from "@/lib/caravanas";
import { sendJsonResult } from "@/lib/mutate";

/** Número DICOSE of the establishment, printed on the SNIG export.
 * The parent keys it by the saved value, so a refresh resets the input. */
export function EstablishmentCard({
  dicoseNumber, readOnly, onSaved,
}: {
  dicoseNumber: string | null;
  readOnly: boolean;
  onSaved: (value: string | null) => void;
}) {
  const [value, setValue] = useState(dicoseNumber || "");
  const [saving, setSaving] = useState(false);

  const parsed = normalizeDicose(value);
  const dirty = (parsed.ok ? parsed.value : value) !== (dicoseNumber || null);

  async function save() {
    if (!parsed.ok) {
      toast.error(parsed.reason);
      return;
    }
    setSaving(true);
    const result = await sendJsonResult("/api/caravanas/dicose", "PUT", { dicoseNumber: parsed.value });
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error || "No se pudo guardar el número DICOSE.");
      return;
    }
    toast.success(parsed.value ? "Número DICOSE guardado" : "Número DICOSE borrado");
    onSaved(parsed.value);
  }

  return (
    <section aria-labelledby="caravanas-establishment-title" className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <form
          className="flex min-w-0 flex-1 flex-col gap-2 sm:max-w-sm"
          onSubmit={(event) => { event.preventDefault(); if (dirty && !readOnly) void save(); }}
        >
          <h2 id="caravanas-establishment-title" className="text-base font-semibold">Establecimiento</h2>
          <Label htmlFor="caravanas-dicose">Número DICOSE</Label>
          <div className="flex gap-2">
            <Input
              id="caravanas-dicose"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              inputMode="numeric"
              autoComplete="off"
              placeholder="Ej.: 213456789"
              disabled={readOnly}
              aria-invalid={!parsed.ok || undefined}
              aria-describedby="caravanas-dicose-hint"
            />
            <Button type="submit" variant="outline" disabled={readOnly || saving || !dirty || !parsed.ok}>{saving ? "Guardando…" : "Guardar"}</Button>
          </div>
          <p id="caravanas-dicose-hint" className={parsed.ok ? "text-xs text-muted-foreground" : "text-xs text-bad"}>
            {parsed.ok ? "Va en la primera columna de la exportación para declaraciones y guías." : parsed.reason}
          </p>
        </form>
        <div className="max-w-sm text-xs text-muted-foreground">
          <p>El SNIG no ofrece una conexión directa para los productores: descargá el listado de animales del establecimiento desde el portal e importalo acá. Lo que cargues en CampoAI no se envía al SNIG.</p>
          <a href={SNIG_PORTAL_URL} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex min-h-11 items-center gap-1.5 font-medium text-primary hover:underline sm:min-h-0">
            Abrir el portal del SNIG<ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        </div>
      </div>
    </section>
  );
}
