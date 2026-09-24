"use client";

import { useState } from "react";
import { AlertTriangle, ArrowRightLeft, CalendarClock, MapPinned } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { sendJsonResult } from "@/lib/mutate";
import { MoveCattleDialog } from "@/components/MoveCattleDialog";
import { categoryLabel, sectionNeedsAttention, type FieldTotals, type RotationMove, type SectionFieldStatus, type StockingLevel } from "@/lib/grazing";
import { safeHexColor } from "@/lib/map-labels";
import { grazingHistoryLine } from "@/lib/grazing-history";

const actionLink = "inline-flex items-center gap-1 rounded-sm font-medium text-primary underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring";

const CROP_BADGE = { label: "Cultivo", className: "border-ok-line bg-ok-soft text-ok" };

const STOCKING_STYLES: Record<StockingLevel, { label: string; className: string }> = {
  over: { label: "Sobrecargado", className: "border-bad-line bg-bad-soft text-bad" },
  high: { label: "Al límite", className: "border-warn-line bg-warn-soft text-warn" },
  ok: { label: "Ocupado", className: "border-ok-line bg-ok-soft text-ok" },
  empty: { label: "Libre", className: "border-border bg-muted text-muted-foreground" },
};

// Only conditions that need attention; a growing pasture is good news.
const PASTURE_LABELS: Record<string, string> = { sobrepastoreado: "pasto sobrepastoreado", seco: "pasto seco" };
const WATER_LABELS: Record<string, string> = { bajo: "agua baja", seco: "sin agua", inundado: "inundado" };

type Filter = "all" | "occupied" | "attention" | "free";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "Todos" },
  { value: "attention", label: "Requieren atención" },
  { value: "occupied", label: "Ocupados" },
  { value: "free", label: "Libres" },
];

function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** One-time start for a potrero's grazing/rest clock when no move has been
 * recorded since the clock existed. */
function ClockSetter({ status, onSaved }: { status: SectionFieldStatus; onSaved?: () => void }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const [saving, setSaving] = useState(false);
  const occupied = status.heads > 0;
  const label = occupied ? "¿Desde cuándo están?" : "¿Desde cuándo está libre?";
  const inputId = `clock-${status.id}`;

  async function save() {
    if (!date || saving) return;
    setSaving(true);
    try {
      const result = await sendJsonResult("/api/field-status", "PUT", { sectionId: status.id, date, today: localToday() });
      if (!result.ok) {
        toast.error(result.error || "No se pudo guardar la fecha.");
        return;
      }
      toast.success(occupied ? `Ingreso a ${status.name} registrado` : `Descanso de ${status.name} registrado`);
      setOpen(false);
      onSaved?.();
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={actionLink}>
        <CalendarClock className="h-3.5 w-3.5" aria-hidden />{label}
      </button>
    );
  }
  return (
    <form className="flex w-full flex-wrap items-center gap-2" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <label htmlFor={inputId} className="text-muted-foreground">{occupied ? "Ingresaron el" : "Libre desde el"}</label>
      <input id={inputId} type="date" required max={localToday()} value={date} onChange={(event) => setDate(event.target.value)} className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground" />
      <button type="submit" disabled={!date || saving} className="h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50">{saving ? "Guardando…" : "Guardar"}</button>
      <button type="button" onClick={() => setOpen(false)} className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground">Cancelar</button>
    </form>
  );
}

function formatNumber(value: number): string {
  return value.toLocaleString("es-UY", { maximumFractionDigits: 2 });
}

interface FieldStatusPanelProps {
  statuses: SectionFieldStatus[];
  totals: FieldTotals | null;
  rotation: RotationMove[];
  showCattle: boolean;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  onFocus: (status: SectionFieldStatus) => void;
  onOpen: (status: SectionFieldStatus) => void;
  /** Hides move actions for viewers and offline copies. */
  readOnly?: boolean;
  onMoved?: () => void;
  /** Start drawing an unplaced potrero on the map. */
  onPlace?: (status: SectionFieldStatus) => void;
}

/** Every potrero with what is in it — including the ones never drawn on the
 * map, which would otherwise be invisible on this page. */
export function FieldStatusPanel({ statuses, totals, rotation, showCattle, loading, error, onRetry, onFocus, onOpen, readOnly = false, onMoved, onPlace }: FieldStatusPanelProps) {
  const [filter, setFilter] = useState<Filter>("all");
  const [moving, setMoving] = useState<{ source: SectionFieldStatus; destinationId: string | null; wholeHerd: boolean } | null>(null);
  const moveBySection = new Map(rotation.map((move) => [move.fromSectionId, move]));
  const visible = statuses.filter((status) => {
    if (filter === "occupied") return status.heads > 0 || status.crops.length > 0;
    if (filter === "free") return status.heads === 0 && status.crops.length === 0;
    if (filter === "attention") return sectionNeedsAttention(status) || moveBySection.has(status.id);
    return true;
  });
  const unplaced = statuses.filter((status) => !status.hasGeometry && !status.padronId).length;


  return (
    <section aria-labelledby="field-status-title">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 id="field-status-title" className="flex items-baseline gap-2 text-base font-semibold">
          Potreros <span className="figure text-sm font-medium text-muted-foreground">{statuses.length}</span>
        </h2>
      </div>
      {totals && showCattle && totals.heads > 0 && (
        <p className="mb-3 text-sm text-muted-foreground">
          <span className="figure text-base font-semibold text-foreground">{formatNumber(totals.heads)}</span> cabezas en {totals.occupied} de {totals.sections} potreros
          {totals.ugPerHa != null && <> · <span className="figure font-semibold text-foreground">{formatNumber(totals.ugPerHa)}</span> UG/ha en {formatNumber(totals.hectares)} ha registradas</>}
        </p>
      )}
      <div role="group" aria-label="Filtrar potreros" className="-mx-1 mb-3 flex gap-1 overflow-x-auto px-1 pb-0.5">
        {FILTERS.map((option) => (
          <button
            type="button"
            key={option.value}
            aria-pressed={filter === option.value}
            onClick={() => setFilter(option.value)}
            className={`min-h-8 shrink-0 rounded-md px-2.5 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${filter === option.value ? "bg-card text-foreground shadow-[0_0_0_1px_var(--border)]" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {error ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md border border-bad-line bg-bad-soft px-3 py-2 text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0 text-bad" aria-hidden />
          <span className="min-w-0 flex-1">No se pudo cargar el estado de los potreros.</span>
          <Button variant="outline" size="xs" onClick={onRetry}>Reintentar</Button>
        </div>
      ) : loading && statuses.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">Cargando potreros…</p>
      ) : statuses.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">Todavía no hay potreros. Dividí un padrón o creá secciones en Hacienda.</p>
      ) : visible.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">Ningún potrero coincide con este filtro.</p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
          {visible.map((status) => {
            const stocking = (!showCattle || status.heads === 0) && status.crops.length > 0
              ? CROP_BADGE
              : STOCKING_STYLES[showCattle ? status.stocking : "empty"];
            const conditions = [
              PASTURE_LABELS[status.pastureStatus],
              WATER_LABELS[status.waterStatus],
            ].filter(Boolean);
            const placed = status.hasGeometry || status.padronId;
            return (
              <li key={status.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => onFocus(status)}
                    disabled={!placed}
                    aria-label={placed ? `Ver ${status.name} en el mapa` : `${status.name} no está ubicado en el mapa`}
                    className="flex min-w-0 items-center gap-2 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring enabled:hover:underline"
                  >
                    <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: safeHexColor(status.color) }} />
                    <span className="truncate text-sm font-medium">{status.name}</span>
                    {status.hectares != null && <span className="shrink-0 text-xs text-muted-foreground"><span className="figure">{formatNumber(status.hectares)}</span> ha</span>}
                  </button>
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${stocking.className}`}>{stocking.label}</span>
                </div>

                <p className="mt-1 text-sm">{status.summary}</p>

                {showCattle && status.heads > 0 && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {status.byCategory.map((row) => `${row.count} ${categoryLabel(row.category, row.count)}`).join(", ")}
                    {` · ${formatNumber(status.ug)} UG`}
                    {status.ugPerHa != null && ` · ${formatNumber(status.ugPerHa)} UG/ha`}
                    {status.stockingReason && ` · ${status.stockingReason}`}
                  </p>
                )}

                {moveBySection.has(status.id) && (() => {
                  const move = moveBySection.get(status.id)!;
                  const best = move.destinations[0];
                  return (
                    <div className="mt-2 rounded-md border border-warn-line bg-warn-soft px-2.5 py-1.5 text-xs">
                      <p className="font-medium text-warn">Conviene mover: {move.reasons.map((reason) => reason.label).join(" · ")}</p>
                      <p className="mt-0.5 text-muted-foreground">
                        {best
                          ? <>Destino sugerido: <span className="font-medium text-foreground">{best.name}</span>{best.notes.length > 0 && ` (${best.notes.join(", ")})`}</>
                          : move.reservedFor
                            ? `${move.reservedFor.sectionName} ya está sugerido para ${move.reservedFor.forName}, que es más urgente.`
                            : "Ningún potrero libre puede recibirlos: revisá capacidad, agua y pasto."}
                      </p>
                    </div>
                  );
                })()}

                {showCattle && grazingHistoryLine(status.history) && (
                  <p className={`mt-1 text-xs ${status.history?.lastRestShort ? "font-medium text-warn" : "text-muted-foreground"}`}>
                    Historial: {grazingHistoryLine(status.history)}
                  </p>
                )}

                {conditions.length > 0 && (
                  <p className="mt-1 text-xs font-medium text-warn">{conditions.join(" · ")}</p>
                )}

                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
                  {showCattle && status.heads > 0 && !readOnly && (
                    <button
                      type="button"
                      onClick={() => setMoving({ source: status, destinationId: moveBySection.get(status.id)?.destinations[0]?.sectionId ?? null, wholeHerd: moveBySection.has(status.id) })}
                      className={actionLink}
                    >
                      <ArrowRightLeft className="h-3.5 w-3.5" aria-hidden />Mover
                    </button>
                  )}
                  <button type="button" onClick={() => onOpen(status)} className={actionLink}>
                    Abrir en Hacienda
                  </button>
                  {showCattle && !readOnly && status.crops.length === 0 && (status.heads > 0 ? status.daysOccupied == null : status.daysRested == null) && (
                    <ClockSetter status={status} onSaved={onMoved} />
                  )}
                  {!placed && (onPlace && !readOnly
                    ? <button type="button" onClick={() => onPlace(status)} className={actionLink}><MapPinned className="h-3.5 w-3.5" aria-hidden />Dibujar en el mapa</button>
                    : <span className="text-muted-foreground">Sin ubicar en el mapa</span>)}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {unplaced > 0 && statuses.length > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          {unplaced === 1 ? "1 potrero no está ubicado" : `${unplaced} potreros no están ubicados`} en el mapa. {onPlace && !readOnly ? "Usá “Dibujar en el mapa” en cada uno." : "Agregá un padrón para poder dibujarlos."}
        </p>
      )}
      <MoveCattleDialog
        open={moving !== null}
        onOpenChange={(open) => { if (!open) setMoving(null); }}
        source={moving?.source ?? null}
        statuses={statuses}
        preferredDestinationId={moving?.destinationId}
        moveWholeHerd={moving?.wholeHerd ?? false}
        onMoved={onMoved}
      />
    </section>
  );
}
