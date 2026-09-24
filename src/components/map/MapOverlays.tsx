"use client";

// Panels that float over the Leaflet map: padrón search, drawing and
// placement prompts, the drawing toolbar and the "centrar" control.

import { AlertTriangle, Crosshair, Loader2, Plus, Search, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DEPARTMENTS, FEATURE_TYPES, featureType, hectaresFromM2 } from "./constants";

/** Floating surface over the map tiles. */
export const floatingPanel = "rounded-lg border border-border bg-popover text-popover-foreground shadow-md";

const fieldClass = "h-9 min-w-0 rounded-md border border-input bg-background px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

interface PadronSearchPanelProps {
  searchDept: string;
  onDeptChange: (value: string) => void;
  searchNum: string;
  onNumChange: (value: string) => void;
  searching: boolean;
  searchResult: GeoJSON.FeatureCollection | null;
  adding: boolean;
  readOnly: boolean;
  onSearch: () => void;
  onAdd: () => void;
}

export function PadronSearchPanel({ searchDept, onDeptChange, searchNum, onNumChange, searching, searchResult, adding, readOnly, onSearch, onAdd }: PadronSearchPanelProps) {
  const found = searchResult && searchResult.features.length > 0 ? searchResult.features[0] : null;
  return (
    <section aria-labelledby="padron-search-title" className={cn(floatingPanel, "p-3")}>
      <h2 id="padron-search-title" className="mb-2 text-sm font-semibold">Buscar padrón</h2>
      <div className="flex gap-1.5">
        <select
          value={searchDept}
          onChange={(e) => onDeptChange(e.target.value)}
          aria-label="Departamento"
          className={cn(fieldClass, "w-[7.5rem] shrink-0 sm:w-40")}
        >
          {DEPARTMENTS.map(([code, name]) => (
            <option key={code} value={code}>{code} — {name}</option>
          ))}
        </select>
        <input
          type="text" inputMode="numeric" pattern="[0-9]*"
          value={searchNum} onChange={(e) => onNumChange(e.target.value.replace(/\D/g, ""))}
          onKeyDown={(e) => e.key === "Enter" && onSearch()}
          placeholder="Número, ej. 995"
          aria-label="Número de padrón"
          className={cn(fieldClass, "flex-1")}
        />
        <Button size="icon" onClick={onSearch} disabled={readOnly || !searchNum.trim() || searching} aria-label={searching ? "Buscando padrón" : "Buscar padrón"}>
          {searching ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Search aria-hidden="true" />}
        </Button>
      </div>

      {searchResult && !found && (
        <p role="status" className="mt-2 text-sm text-bad">No encontramos el padrón {searchDept}-{searchNum}. Revisá el departamento y el número.</p>
      )}
      {found && (
        <div className="mt-2.5 flex items-center justify-between gap-2 rounded-md bg-muted px-3 py-2">
          <div className="min-w-0 text-sm">
            <p className="font-medium">{searchDept}-{searchNum}</p>
            <p className="truncate text-xs text-muted-foreground">
              {found.properties?.nomDepto}
              {found.properties?.["SHAPE.STArea()"] && <> · <span className="figure">{hectaresFromM2(found.properties["SHAPE.STArea()"])}</span> ha</>}
            </p>
          </div>
          <Button size="sm" onClick={onAdd} disabled={readOnly || adding}>
            {adding ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Plus aria-hidden="true" />}
            {adding ? "Agregando…" : "Agregar al campo"}
          </Button>
        </div>
      )}
    </section>
  );
}

export function MapActionError({ message, showDiagnostic, onDiagnostic }: { message: string; showDiagnostic: boolean; onDiagnostic: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border border-bad-line bg-bad-soft px-3 py-2 text-sm text-foreground shadow-md">
      <AlertTriangle className="h-4 w-4 shrink-0 text-bad" aria-hidden="true" />
      <span className="min-w-0 flex-1">{message}</span>
      {showDiagnostic && (
        <Button variant="outline" size="xs" onClick={onDiagnostic}>Abrir diagnóstico</Button>
      )}
    </div>
  );
}

interface DrawOverlayProps {
  drawMode: string;
  drawName: string;
  onNameChange: (value: string) => void;
  pointCount: number;
  isPointType: boolean;
  readOnly: boolean;
  saving: boolean;
  onUndo: () => void;
  onSave: () => void;
  onCancel: () => void;
}

export function DrawOverlay({ drawMode, drawName, onNameChange, pointCount, isPointType, readOnly, saving, onUndo, onSave, onCancel }: DrawOverlayProps) {
  const type = featureType(drawMode);
  return (
    <section aria-label={`Dibujando ${type?.label ?? drawMode}`} className={cn(floatingPanel, "p-3")}>
      <p className="mb-2 text-sm">
        <span className="font-medium">{type?.icon} {type?.label}</span>
        <span className="text-muted-foreground">
          {" · "}
          {isPointType ? "Tocá el mapa para ubicarlo." : <>Tocá el mapa para agregar puntos (<span className="figure">{pointCount}</span> {pointCount === 1 ? "punto" : "puntos"}).</>}
        </span>
      </p>
      <div className="flex flex-wrap gap-1.5">
        <input
          type="text" value={drawName} onChange={(e) => onNameChange(e.target.value)}
          placeholder="Nombre (opcional)"
          aria-label="Nombre del elemento"
          className={cn(fieldClass, "min-w-[8rem] flex-1")}
        />
        {!isPointType && pointCount > 0 && (
          <Button variant="ghost" onClick={onUndo}><Undo2 aria-hidden="true" />Deshacer</Button>
        )}
        <Button onClick={onSave} disabled={readOnly || pointCount === 0 || (!isPointType && pointCount < 2) || saving}>
          {saving ? "Guardando…" : "Guardar"}
        </Button>
        <Button variant="ghost" onClick={onCancel}>Cancelar</Button>
      </div>
    </section>
  );
}

interface PlacementOverlayProps {
  sectionName: string | null;
  pointCount: number;
  saving: boolean;
  onSave: () => void;
  onUndo: () => void;
  onCancel: () => void;
}

export function PlacementOverlay({ sectionName, pointCount, saving, onSave, onUndo, onCancel }: PlacementOverlayProps) {
  return (
    <section aria-label="Dibujar potrero" className={cn(floatingPanel, "p-3")}>
      <p className="text-sm">
        {sectionName ? <>Tocá el mapa para marcar los vértices de <strong className="font-semibold">{sectionName}</strong>.</> : "Tocá el mapa para marcar los vértices del área."}
        {pointCount > 0 && (
          <span className="text-muted-foreground"> <span className="figure">{pointCount}</span> {pointCount === 1 ? "punto" : "puntos"}{pointCount < 3 ? ", mínimo 3" : ""}.</span>
        )}
      </p>
      {sectionName && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Button size="sm" onClick={onSave} disabled={pointCount < 3 || saving}>{saving ? "Guardando…" : "Guardar potrero"}</Button>
          {pointCount > 0 && <Button size="sm" variant="ghost" onClick={onUndo}><Undo2 aria-hidden="true" />Deshacer</Button>}
          <Button size="sm" variant="ghost" onClick={onCancel}>Cancelar</Button>
        </div>
      )}
    </section>
  );
}

/** The on-map icon of a feature type, as used by its markers. */
export function FeatureSwatch({ value }: { value: string }) {
  const type = featureType(value);
  if (!type) return <span aria-hidden="true">📍</span>;
  return <span aria-hidden="true" className="text-base leading-none">{type.icon}</span>;
}

export function DrawToolbar({ drawMode, onToggle }: { drawMode: string | null; onToggle: (value: string) => void }) {
  return (
    <div role="toolbar" aria-label="Dibujar en el mapa" className={cn(floatingPanel, "flex gap-1 overflow-x-auto p-1")}>
      {FEATURE_TYPES.map((ft) => {
        const active = drawMode === ft.value;
        return (
          <button
            type="button"
            key={ft.value}
            onClick={() => onToggle(ft.value)}
            aria-pressed={active}
            aria-label={`${active ? "Desactivar" : "Activar"} herramienta ${ft.label}`}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
              active ? "bg-primary-soft text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <FeatureSwatch value={ft.value} />
            {ft.label}
          </button>
        );
      })}
    </div>
  );
}

export function LocateButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      variant="outline" size="icon"
      onClick={onClick}
      title="Centrar en mi campo" aria-label="Centrar el mapa en mi campo"
      className="border-border bg-popover shadow-md"
    >
      <Crosshair aria-hidden="true" />
    </Button>
  );
}
