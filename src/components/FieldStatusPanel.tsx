"use client";

import { useState } from "react";
import { categoryLabel, sectionNeedsAttention, type FieldTotals, type SectionFieldStatus, type StockingLevel } from "@/lib/grazing";
import { safeHexColor } from "@/lib/map-labels";

const STOCKING_STYLES: Record<StockingLevel, { label: string; className: string }> = {
  over: { label: "Sobrecargado", className: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300" },
  high: { label: "Al límite", className: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300" },
  ok: { label: "Ocupado", className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  empty: { label: "Libre", className: "border-border bg-muted text-muted-foreground" },
};

const PASTURE_LABELS: Record<string, string> = { sobrepastoreado: "pasto sobrepastoreado", seco: "pasto seco", creciendo: "pasto creciendo" };
const WATER_LABELS: Record<string, string> = { bajo: "agua baja", seco: "sin agua", inundado: "inundado" };

type Filter = "all" | "occupied" | "attention" | "free";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "Todos" },
  { value: "attention", label: "Requieren atención" },
  { value: "occupied", label: "Ocupados" },
  { value: "free", label: "Libres" },
];

function formatNumber(value: number): string {
  return value.toLocaleString("es-UY", { maximumFractionDigits: 2 });
}

interface FieldStatusPanelProps {
  statuses: SectionFieldStatus[];
  totals: FieldTotals | null;
  showCattle: boolean;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  onFocus: (status: SectionFieldStatus) => void;
  onOpen: (status: SectionFieldStatus) => void;
}

/** Every potrero with what is in it — including the ones never drawn on the
 * map, which would otherwise be invisible on this page. */
export function FieldStatusPanel({ statuses, totals, showCattle, loading, error, onRetry, onFocus, onOpen }: FieldStatusPanelProps) {
  const [filter, setFilter] = useState<Filter>("all");
  const visible = statuses.filter((status) => {
    if (filter === "occupied") return status.heads > 0 || status.crops.length > 0;
    if (filter === "free") return status.heads === 0 && status.crops.length === 0;
    if (filter === "attention") return sectionNeedsAttention(status);
    return true;
  });
  const unplaced = statuses.filter((status) => !status.hasGeometry && !status.padronId).length;

  return (
    <section aria-labelledby="field-status-title" className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 id="field-status-title" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Potreros ({statuses.length})</h3>
          {totals && showCattle && totals.heads > 0 && (
            <p className="mt-1 text-sm text-muted-foreground">
              {formatNumber(totals.heads)} cabezas en {totals.occupied} de {totals.sections} potreros
              {totals.ugPerHa != null && ` · ${formatNumber(totals.ugPerHa)} UG/ha en ${formatNumber(totals.hectares)} ha registradas`}
            </p>
          )}
        </div>
        <div role="group" aria-label="Filtrar potreros" className="flex flex-wrap gap-1.5">
          {FILTERS.map((option) => (
            <button
              type="button"
              key={option.value}
              aria-pressed={filter === option.value}
              onClick={() => setFilter(option.value)}
              className={`min-h-8 rounded-lg border px-2.5 text-xs font-medium transition-colors ${filter === option.value ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <div role="alert" className="flex items-center justify-between rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
          <span>No se pudo cargar el estado de los potreros.</span>
          <button type="button" onClick={onRetry} className="underline">Reintentar</button>
        </div>
      ) : loading && statuses.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">Cargando potreros…</p>
      ) : statuses.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">Todavía no hay potreros. Dividí un padrón o creá secciones en Hacienda.</p>
      ) : visible.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">Ningún potrero coincide con este filtro.</p>
      ) : (
        <ul className="grid gap-2 md:grid-cols-2">
          {visible.map((status) => {
            const stocking = STOCKING_STYLES[showCattle ? status.stocking : status.crops.length > 0 ? "ok" : "empty"];
            const conditions = [
              PASTURE_LABELS[status.pastureStatus],
              WATER_LABELS[status.waterStatus],
            ].filter(Boolean);
            const placed = status.hasGeometry || status.padronId;
            return (
              <li key={status.id} className="rounded-lg border border-border bg-muted/30 p-3">
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => onFocus(status)}
                    disabled={!placed}
                    aria-label={placed ? `Ver ${status.name} en el mapa` : `${status.name} no está ubicado en el mapa`}
                    className="flex min-w-0 items-center gap-2 text-left enabled:hover:opacity-80"
                  >
                    <span aria-hidden className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: safeHexColor(status.color) }} />
                    <span className="truncate text-sm font-medium">{status.name}</span>
                    {status.hectares != null && <span className="shrink-0 text-xs text-muted-foreground">{formatNumber(status.hectares)} ha</span>}
                  </button>
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${stocking.className}`}>{stocking.label}</span>
                </div>

                <p className="mt-1.5 text-sm">{status.summary}</p>

                {showCattle && status.heads > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {status.byCategory.map((row) => `${row.count} ${categoryLabel(row.category, row.count)}`).join(", ")}
                    {` · ${formatNumber(status.ug)} UG`}
                    {status.ugPerHa != null && ` · ${formatNumber(status.ugPerHa)} UG/ha`}
                    {status.stockingReason && ` · ${status.stockingReason}`}
                  </p>
                )}

                {conditions.length > 0 && (
                  <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-300">{conditions.join(" · ")}</p>
                )}

                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                  <button type="button" onClick={() => onOpen(status)} className="font-medium text-primary underline-offset-2 hover:underline">
                    Abrir en Hacienda
                  </button>
                  {!placed && <span className="text-muted-foreground">Sin ubicar en el mapa</span>}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {unplaced > 0 && statuses.length > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          {unplaced === 1 ? "1 potrero no está ubicado" : `${unplaced} potreros no están ubicados`} en el mapa. Usá “+ Dividir” en un padrón para dibujarlos.
        </p>
      )}
    </section>
  );
}
