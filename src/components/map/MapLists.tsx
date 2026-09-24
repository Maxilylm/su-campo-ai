"use client";

// The map's side panel content (padrones, infrastructure) and its notices.

import { AlertTriangle, Info, PencilRuler, Scissors, Undo2 } from "lucide-react";
import { AuthenticatedDownloadLink } from "@/components/AuthenticatedDownloadLink";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { FeatureSwatch } from "./MapOverlays";
import { SECTION_COLORS, SECTION_COLOR_NAMES, featureType, hectaresFromM2, padronColor, type MapFeature, type Padron } from "./constants";

const listSurface = "divide-y divide-border overflow-hidden rounded-lg border border-border bg-card";
const inputClass = "h-9 min-w-0 rounded-md border border-input bg-background px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

interface MapNoticesProps {
  className?: string;
  offlineReadOnly: boolean;
  offlineMapAvailable: boolean | null;
  offlineMapSavedAt: string | null;
  loadError: boolean;
  onRetry: () => void;
  padronesTruncated: boolean;
  featuresTruncated: boolean;
}

export function MapNotices({ className, offlineReadOnly, offlineMapAvailable, offlineMapSavedAt, loadError, onRetry, padronesTruncated, featuresTruncated }: MapNoticesProps) {
  const notices: React.ReactNode[] = [];
  if (offlineReadOnly && offlineMapAvailable === false) {
    notices.push(
      <div key="no-copy" role="alert" className="flex gap-2 rounded-md border border-warn-line bg-warn-soft px-3 py-2 text-sm">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
        <span>El mapa no tiene una copia local disponible. Sincronizá el modo offline cuando recuperes la conexión.</span>
      </div>,
    );
  }
  if (offlineReadOnly && offlineMapSavedAt) {
    notices.push(
      <div key="offline-copy" role="status" className="flex gap-2 rounded-md border border-warn-line bg-warn-soft px-3 py-2 text-sm">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
        <span>Mostrando el mapa de la copia sincronizada el {new Date(offlineMapSavedAt).toLocaleString("es-UY")}. El mapa está en modo lectura.</span>
      </div>,
    );
  }
  if (loadError) {
    notices.push(
      <div key="load-error" role="alert" className="flex flex-wrap items-center gap-2 rounded-md border border-bad-line bg-bad-soft px-3 py-2 text-sm">
        <AlertTriangle className="h-4 w-4 shrink-0 text-bad" aria-hidden="true" />
        <span className="min-w-0 flex-1">{offlineReadOnly ? "No hay una copia local completa del mapa." : "No se pudo cargar toda la información del mapa. Revisá tu conexión y reintentá."}</span>
        {!offlineReadOnly && <Button variant="outline" size="xs" onClick={onRetry}>Reintentar</Button>}
      </div>,
    );
  }
  if (padronesTruncated || featuresTruncated) {
    notices.push(
      <div key="truncated" role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-warn-line bg-warn-soft px-3 py-2 text-sm">
        <span className="min-w-0 flex-1">
          {padronesTruncated && featuresTruncated
            ? "El mapa muestra solo los 1.000 padrones y 1.000 elementos de infraestructura más recientes."
            : padronesTruncated
              ? "El mapa muestra solo los 1.000 padrones más recientes."
              : "El mapa muestra solo los 1.000 elementos de infraestructura más recientes."}
        </span>
        {padronesTruncated && <AuthenticatedDownloadLink href="/api/export?format=csv&table=padrones" filename="campoai-padrones.csv" className="shrink-0 font-medium text-primary underline underline-offset-2">Padrones CSV</AuthenticatedDownloadLink>}
        {featuresTruncated && <AuthenticatedDownloadLink href="/api/export?format=csv&table=map_features" filename="campoai-infraestructura.csv" className="shrink-0 font-medium text-primary underline underline-offset-2">Infraestructura CSV</AuthenticatedDownloadLink>}
      </div>,
    );
  }
  if (notices.length === 0) return null;
  return <div className={cn("space-y-2", className)}>{notices}</div>;
}

export interface SubdivideState {
  name: string;
  onNameChange: (value: string) => void;
  hectares: string;
  onHectaresChange: (value: string) => void;
  color: string;
  onColorChange: (value: string) => void;
  pointCount: number;
  placingArea: boolean;
  onTogglePlacing: (padron: Padron) => void;
  onUndo: () => void;
  onCreate: (padronId: string) => void;
  onCancel: () => void;
  saving: boolean;
}

function SubdivideForm({ padron, state, readOnly }: { padron: Padron; state: SubdivideState; readOnly: boolean }) {
  const nameId = `subdivide-name-${padron.id}`;
  const haId = `subdivide-ha-${padron.id}`;
  const colorLabelId = `subdivide-color-${padron.id}`;
  const areaMarked = state.pointCount >= 3;
  return (
    <div className="mt-3 space-y-3 rounded-md border border-border bg-muted/50 p-3">
      <p className="text-xs text-muted-foreground">Nueva sección dentro de {padron.padron_code}</p>
      <div className="flex gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <label htmlFor={nameId} className="text-xs font-medium">Nombre</label>
          <input id={nameId} type="text" value={state.name} onChange={(e) => state.onNameChange(e.target.value)}
            placeholder={`Ej: ${padron.padron_code} Norte`} className={cn(inputClass, "w-full")} />
        </div>
        <div className="w-24 space-y-1">
          <label htmlFor={haId} className="text-xs font-medium">Hectáreas</label>
          <input id={haId} type="text" inputMode="decimal" value={state.hectares} onChange={(e) => state.onHectaresChange(e.target.value)}
            placeholder="ha" className={cn(inputClass, "w-full")} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span id={colorLabelId} className="text-xs font-medium">Color</span>
        <div role="group" aria-labelledby={colorLabelId} className="flex gap-1.5">
          {SECTION_COLORS.map((c) => (
            <button type="button" key={c} onClick={() => state.onColorChange(c)} aria-label={`Color ${SECTION_COLOR_NAMES[c] ?? c}`} aria-pressed={state.color === c}
              title={SECTION_COLOR_NAMES[c] ?? c}
              className={cn("h-6 w-6 rounded-full border-2 outline-none transition-transform focus-visible:ring-2 focus-visible:ring-ring", state.color === c ? "scale-110 border-foreground" : "border-card")}
              style={{ backgroundColor: c }} />
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => state.onTogglePlacing(padron)}
          aria-pressed={state.placingArea}
          className={cn(areaMarked && "border-ok-line text-ok", !areaMarked && state.placingArea && "border-warn-line text-warn")}
        >
          <PencilRuler aria-hidden="true" />
          {areaMarked ? `Área marcada (${state.pointCount} puntos)` : state.placingArea ? `Dibujando… (${state.pointCount} puntos)` : "Dibujar área en el mapa"}
        </Button>
        {state.placingArea && state.pointCount > 0 && (
          <Button size="sm" variant="ghost" onClick={state.onUndo}><Undo2 aria-hidden="true" />Deshacer</Button>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={state.onCancel}>Cancelar</Button>
        <Button size="sm" onClick={() => state.onCreate(padron.id)} disabled={readOnly || !state.name.trim() || state.saving}>
          {state.saving ? "Guardando…" : "Crear sección"}
        </Button>
      </div>
    </div>
  );
}

interface PadronListProps {
  padrones: Padron[];
  truncated: boolean;
  subdividingId: string | null;
  subdivide: SubdivideState;
  readOnly: boolean;
  onFocus: (padron: Padron) => void;
  onToggleSubdivide: (padron: Padron) => void;
  onDelete: (id: string) => void;
  onOpenSection: (sectionId: string) => void;
}

export function PadronList({ padrones, truncated, subdividingId, subdivide, readOnly, onFocus, onToggleSubdivide, onDelete, onOpenSection }: PadronListProps) {
  return (
    <section aria-labelledby="padrones-title">
      <h2 id="padrones-title" className="mb-2 flex items-baseline gap-2 text-base font-semibold">
        Padrones <span className="figure text-sm font-medium text-muted-foreground">{padrones.length}{truncated ? "+" : ""}</span>
      </h2>
      {padrones.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          Buscá tu primer padrón en el mapa y agregalo al campo.
        </p>
      ) : (
        <ul className={listSurface}>
          {padrones.map((p, i) => (
            <li key={p.id} className="px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <button type="button" onClick={() => onFocus(p)} aria-label={`Centrar padrón ${p.padron_code} en el mapa`}
                  className="flex min-w-0 items-center gap-2 rounded-sm text-left outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
                  <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: padronColor(i) }} />
                  <span className="text-sm font-medium">{p.padron_code}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {p.department_name}
                    {p.area_m2 ? <> · <span className="figure">{hectaresFromM2(p.area_m2)}</span> ha</> : null}
                  </span>
                </button>
                <div className="flex shrink-0 gap-1">
                  <Button variant="ghost" size="xs" onClick={() => onToggleSubdivide(p)}
                    aria-expanded={subdividingId === p.id}
                    aria-label={`${subdividingId === p.id ? "Ocultar" : "Abrir"} división de ${p.padron_code}`}
                    className="text-muted-foreground">
                    <Scissors aria-hidden="true" />Dividir
                  </Button>
                  <Button variant="ghost" size="xs" onClick={() => onDelete(p.id)} aria-label={`Quitar padrón ${p.padron_code}`}
                    className="text-muted-foreground hover:text-bad">
                    Quitar
                  </Button>
                </div>
              </div>

              {p.sections && p.sections.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5 pl-[18px]">
                  {p.sections.map((s) => (
                    <button type="button"
                      key={s.id}
                      onClick={() => onOpenSection(s.id)}
                      title={`Abrir ${s.name} en Hacienda`}
                      className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs text-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
                      {s.name}
                    </button>
                  ))}
                </div>
              )}

              {subdividingId === p.id && <SubdivideForm padron={p} state={subdivide} readOnly={readOnly} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function FeatureList({ features, truncated, onDelete }: { features: MapFeature[]; truncated: boolean; onDelete: (id: string) => void }) {
  return (
    <section aria-labelledby="features-title">
      <h2 id="features-title" className="mb-2 flex items-baseline gap-2 text-base font-semibold">
        Infraestructura <span className="figure text-sm font-medium text-muted-foreground">{features.length}{truncated ? "+" : ""}</span>
      </h2>
      {features.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          Usá la barra de dibujo del mapa para marcar caminos, porteras, alambrados y aguadas.
        </p>
      ) : (
        <ul className={listSurface}>
          {features.map((f) => {
            const ft = featureType(f.type);
            return (
              <li key={f.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                <div className="flex min-w-0 items-center gap-2.5">
                  <FeatureSwatch value={f.type} />
                  <span className="truncate text-sm">{f.name || ft?.label || f.type}</span>
                  {f.name && ft && <span className="shrink-0 text-xs text-muted-foreground">{ft.label}</span>}
                </div>
                <Button variant="ghost" size="xs" onClick={() => onDelete(f.id)} aria-label={`Quitar ${f.name || ft?.label || "elemento de infraestructura"}`}
                  className="shrink-0 text-muted-foreground hover:text-bad">
                  Quitar
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
