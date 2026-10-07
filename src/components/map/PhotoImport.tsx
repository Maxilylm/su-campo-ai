"use client";

import { useRef } from "react";
import { Check, Eye, EyeOff, ImageUp, Loader2, Maximize2, Minimize2, Scan, Undo2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatDistance, pathLengthMeters } from "@/lib/geo-measure";
import { draftLineString, type MapExtraction, type OverlayBounds } from "@/lib/map-photo-import";
import { waterPointKindLabel } from "@/lib/water-points";
import { floatingPanel } from "./MapOverlays";
import type { DraftItemState, ExistingSection, PotreroAction } from "./useMapPhotoImport";

/** Opens the file picker; on phones `capture` is not forced, so a saved photo works too. */
export function PhotoImportButton({ disabled, busy, onFile }: { disabled: boolean; busy: boolean; onFile: (file: File) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onFile(file);
        }}
      />
      <Button
        variant="outline" size="sm"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || busy}
        title="Sacale una foto al plano del campo y la IA marca potreros, aguadas y alambrados"
        aria-label={busy ? "Leyendo el plano" : "Cargar el plano del campo desde una foto"}
        className="border-border bg-popover shadow-md pointer-coarse:min-w-11"
      >
        {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <ImageUp aria-hidden="true" />}
        {/* Icon-only on phones, where the search panel needs the width. */}
        <span className="hidden sm:inline">{busy ? "Leyendo plano…" : "Plano desde foto"}</span>
      </Button>
    </>
  );
}

interface PhotoImportControlsProps {
  opacity: number;
  onOpacityChange: (value: number) => void;
  showDrafts: boolean;
  onToggleDrafts: () => void;
  onAdjust: (how: "padrones" | "view" | "bigger" | "smaller") => void;
  hasPadrones: boolean;
  pending: number;
  onFinish: () => void;
}

/** Floating panel while the photo is pinned: line it up, then confirm below. */
export function PhotoImportControls({ opacity, onOpacityChange, showDrafts, onToggleDrafts, onAdjust, hasPadrones, pending, onFinish }: PhotoImportControlsProps) {
  return (
    <section aria-labelledby="photo-import-title" className={cn(floatingPanel, "space-y-2.5 p-3")}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 id="photo-import-title" className="text-sm font-semibold">Alineá el plano</h2>
          <p className="text-xs text-muted-foreground sm:hidden">Arrastrá las esquinas o el centro.</p>
          <p className="hidden text-xs text-muted-foreground sm:block">Arrastrá las esquinas blancas o el centro hasta que coincida con la imagen satelital.</p>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onFinish} aria-label="Cerrar el plano importado"><X aria-hidden="true" /></Button>
      </div>
      <div className="flex items-center gap-2">
        <label htmlFor="plan-opacity" className="shrink-0 text-xs font-medium">Transparencia</label>
        <input
          id="plan-opacity" type="range" min={0.1} max={1} step={0.05}
          value={opacity} onChange={(event) => onOpacityChange(Number(event.target.value))}
          className="h-6 min-w-0 flex-1 accent-[var(--primary)] pointer-coarse:h-11"
          aria-valuetext={`${Math.round(opacity * 100)} %`}
        />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {hasPadrones && <Button variant="outline" size="xs" onClick={() => onAdjust("padrones")}><Scan aria-hidden="true" />Al padrón</Button>}
        <Button variant="outline" size="xs" onClick={() => onAdjust("view")}>A la vista</Button>
        <Button variant="outline" size="icon-xs" onClick={() => onAdjust("smaller")} aria-label="Achicar el plano"><Minimize2 aria-hidden="true" /></Button>
        <Button variant="outline" size="icon-xs" onClick={() => onAdjust("bigger")} aria-label="Agrandar el plano"><Maximize2 aria-hidden="true" /></Button>
        <Button variant="ghost" size="xs" onClick={onToggleDrafts} aria-pressed={showDrafts}>
          {showDrafts ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}{showDrafts ? "Ocultar borradores" : "Ver borradores"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {pending > 0
          ? <>Quedan <span className="figure font-medium text-foreground">{pending}</span> por confirmar en la lista <span className="lg:hidden">debajo del mapa</span><span className="hidden lg:inline">del panel</span>.</>
          : "No queda nada por confirmar."}
      </p>
    </section>
  );
}

interface PhotoImportReviewProps {
  extraction: MapExtraction;
  bounds: OverlayBounds;
  items: Record<string, DraftItemState>;
  readOnly: boolean;
  existingFor: (name: string) => ExistingSection | null;
  onConfirmPotrero: (key: string, action: PotreroAction, existing: ExistingSection | null) => void;
  onConfirmAguada: (key: string) => void;
  onConfirmLine: (key: string) => void;
  onConfirmAll: () => void;
  onDiscard: (key: string) => void;
  onRestore: (key: string) => void;
  onFinish: () => void;
}

function ItemRow({ title, detail, state, children, onDiscard, onRestore }: {
  title: string; detail: string; state: DraftItemState | undefined; children: React.ReactNode; onDiscard: () => void; onRestore: () => void;
}) {
  const status = state?.status ?? "pending";
  return (
    <li className={cn("px-4 py-2.5", status === "discarded" && "opacity-60")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className={cn("truncate text-sm font-medium", status === "discarded" && "line-through")}>{title}</p>
          <p className="truncate text-xs text-muted-foreground">{detail}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1">
          {status === "done" && <Badge variant="ok"><Check aria-hidden="true" />{state?.result ?? "Guardado"}</Badge>}
          {status === "saving" && <Badge variant="muted"><Loader2 className="animate-spin" aria-hidden="true" />Guardando…</Badge>}
          {(status === "pending" || status === "error") && (
            <>
              {children}
              <Button variant="ghost" size="sm" onClick={onDiscard} className="text-muted-foreground">Descartar</Button>
            </>
          )}
          {status === "discarded" && <Button variant="ghost" size="sm" onClick={onRestore}><Undo2 aria-hidden="true" />Recuperar</Button>}
        </div>
      </div>
      {status === "error" && state?.error && <p role="alert" className="mt-1 text-xs text-bad">{state.error}</p>}
    </li>
  );
}

/** Every shape read from the photo, each with its own confirm button. */
export function PhotoImportReview({
  extraction, bounds, items, readOnly, existingFor,
  onConfirmPotrero, onConfirmAguada, onConfirmLine, onConfirmAll, onDiscard, onRestore, onFinish,
}: PhotoImportReviewProps) {
  const pending = Object.values(items).filter((item) => item.status === "pending" || item.status === "error").length;
  const saving = Object.values(items).some((item) => item.status === "saving");
  const listSurface = "divide-y divide-border overflow-hidden rounded-lg border border-border bg-card";
  return (
    <section aria-labelledby="photo-review-title" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="photo-review-title" className="text-base font-semibold">Plano importado</h2>
        <div className="flex gap-1.5">
          {!readOnly && pending > 0 && <Button size="sm" onClick={onConfirmAll} disabled={saving}>Crear todo lo pendiente</Button>}
          <Button size="sm" variant="outline" onClick={onFinish} disabled={saving}>Terminar</Button>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        Nada se guarda hasta que lo confirmes. Alineá la foto primero: cada forma se ubica según la posición actual del plano.
      </p>
      {extraction.notes && <p className="rounded-md border border-warn-line bg-warn-soft px-3 py-2 text-sm">{extraction.notes}</p>}

      {extraction.potreros.length > 0 && (
        <div>
          <h3 className="mb-1.5 text-sm font-medium">Potreros <span className="figure text-muted-foreground">{extraction.potreros.length}</span></h3>
          <ul className={listSurface}>
            {extraction.potreros.map((potrero) => {
              const existing = existingFor(potrero.name);
              return (
                <ItemRow
                  key={potrero.key}
                  title={potrero.name}
                  detail={[
                    potrero.hectares != null ? `${potrero.hectares.toLocaleString("es-UY")} ha según el plano` : "sin hectáreas en el plano",
                    existing ? `ya existe ${existing.hasPolygon ? "dibujado" : "sin dibujar"}` : null,
                  ].filter(Boolean).join(" · ")}
                  state={items[potrero.key]}
                  onDiscard={() => onDiscard(potrero.key)}
                  onRestore={() => onRestore(potrero.key)}
                >
                  {!readOnly && existing && (
                    <Button size="sm" variant={existing.hasPolygon ? "outline" : "default"} onClick={() => onConfirmPotrero(potrero.key, "place", existing)}>
                      {existing.hasPolygon ? "Reemplazar dibujo" : `Ubicar ${existing.name}`}
                    </Button>
                  )}
                  {!readOnly && (
                    <Button size="sm" variant={existing ? "outline" : "default"} onClick={() => onConfirmPotrero(potrero.key, "create", null)}>
                      {existing ? "Crear otro" : "Crear potrero"}
                    </Button>
                  )}
                </ItemRow>
              );
            })}
          </ul>
        </div>
      )}

      {extraction.aguadas.length > 0 && (
        <div>
          <h3 className="mb-1.5 text-sm font-medium">Aguadas <span className="figure text-muted-foreground">{extraction.aguadas.length}</span></h3>
          <ul className={listSurface}>
            {extraction.aguadas.map((aguada) => (
              <ItemRow key={aguada.key} title={aguada.name} detail={waterPointKindLabel(aguada.kind)} state={items[aguada.key]}
                onDiscard={() => onDiscard(aguada.key)} onRestore={() => onRestore(aguada.key)}>
                {!readOnly && <Button size="sm" onClick={() => onConfirmAguada(aguada.key)}>Registrar</Button>}
              </ItemRow>
            ))}
          </ul>
        </div>
      )}

      {extraction.lines.length > 0 && (
        <div>
          <h3 className="mb-1.5 text-sm font-medium">Alambrados y caminos <span className="figure text-muted-foreground">{extraction.lines.length}</span></h3>
          <ul className={listSurface}>
            {extraction.lines.map((line) => {
              const label = line.type === "alambrado" ? "Alambrado" : "Camino";
              const meters = pathLengthMeters(draftLineString(line.points, bounds).coordinates);
              return (
                <ItemRow key={line.key} title={line.name ?? label} detail={`${line.name ? `${label} · ` : ""}${formatDistance(meters)} con la alineación actual`} state={items[line.key]}
                  onDiscard={() => onDiscard(line.key)} onRestore={() => onRestore(line.key)}>
                  {!readOnly && <Button size="sm" onClick={() => onConfirmLine(line.key)}>Crear</Button>}
                </ItemRow>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
