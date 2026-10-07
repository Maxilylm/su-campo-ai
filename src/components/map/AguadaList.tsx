"use client";

import { CheckCheck, Droplets } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SchemaMigrationNotice } from "@/components/SchemaMigrationNotice";
import { cn } from "@/lib/utils";
import {
  checkedLabel, isCheckOverdue, sortWaterPoints, waterPointKindLabel, waterPointStatusLabel, waterStatusTone,
  type WaterPoint,
} from "@/lib/water-points";
import { WATER_STATUS_COLORS } from "./constants";

interface AguadaListProps {
  points: WaterPoint[];
  sectionNames: Map<string, string>;
  truncated: boolean;
  migrationRequired: boolean;
  loadError: boolean;
  readOnly: boolean;
  /** Id of the aguada whose "revisada" write is in flight. */
  checkingId: string | null;
  onOpen: (point: WaterPoint) => void;
  onMarkChecked: (point: WaterPoint) => void;
  onRetry: () => void;
}

function DropSwatch({ status }: { status: string }) {
  return (
    <svg aria-hidden="true" width="14" height="18" viewBox="-1 -1 32 42" className="shrink-0">
      <path d="M15 1C15 1 3 15 3 25a12 12 0 0 0 24 0C27 15 15 1 15 1Z" fill={WATER_STATUS_COLORS[status] ?? WATER_STATUS_COLORS.ok} stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
    </svg>
  );
}

/** Aguadas as a list: problems first, each with its state, what it serves
 * and a one-tap "revisada". */
export function AguadaList({ points, sectionNames, truncated, migrationRequired, loadError, readOnly, checkingId, onOpen, onMarkChecked, onRetry }: AguadaListProps) {
  const sorted = sortWaterPoints(points);
  const problems = points.filter((point) => point.status !== "ok").length;
  return (
    <section aria-labelledby="aguadas-title">
      <h2 id="aguadas-title" className="mb-2 flex items-baseline gap-2 text-base font-semibold">
        Aguadas <span className="figure text-sm font-medium text-muted-foreground">{points.length}{truncated ? "+" : ""}</span>
        {problems > 0 && <Badge variant="bad" className="ml-auto self-center">{problems} con problemas</Badge>}
      </h2>
      {migrationRequired ? (
        <SchemaMigrationNotice migrations={["supabase/055_aguadas.sql"]} />
      ) : loadError ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md border border-bad-line bg-bad-soft px-3 py-2 text-sm">
          <span className="min-w-0 flex-1">No se pudieron cargar las aguadas.</span>
          <Button variant="outline" size="xs" onClick={onRetry}>Reintentar</Button>
        </div>
      ) : sorted.length === 0 ? (
        <p className="flex flex-col items-center gap-1 rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          <Droplets className="h-5 w-5" aria-hidden="true" />
          Marcá tajamares, bebederos y pozos con la herramienta Aguada del mapa.
        </p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
          {sorted.map((point) => {
            const served = point.section_ids.map((id) => sectionNames.get(id)).filter((name): name is string => Boolean(name));
            const overdue = isCheckOverdue(point.last_checked_at);
            return (
              <li key={point.id} className="flex items-start gap-2 px-4 py-2.5">
                <button
                  type="button"
                  onClick={() => onOpen(point)}
                  className="flex min-h-11 min-w-0 flex-1 items-start gap-2.5 rounded-sm text-left outline-none hover:[&_.aguada-name]:underline focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`Abrir aguada ${point.name}: ${waterPointStatusLabel(point.status)}`}
                >
                  <span className="mt-0.5"><DropSwatch status={point.status} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="aguada-name truncate text-sm font-medium">{point.name}</span>
                      <Badge variant={waterStatusTone(point.status)}>{waterPointStatusLabel(point.status)}</Badge>
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {waterPointKindLabel(point.kind)}
                      {served.length > 0 ? ` · ${served.join(", ")}` : " · sin potreros"}
                      {" · "}
                      <span className={cn(overdue && "text-warn")}>{checkedLabel(point.last_checked_at)}</span>
                      {!point.location && " · sin ubicar"}
                    </span>
                  </span>
                </button>
                {!readOnly && (
                  <Button
                    variant="ghost" size="sm"
                    onClick={() => onMarkChecked(point)}
                    disabled={checkingId === point.id}
                    aria-label={`Marcar ${point.name} como revisada hoy`}
                    title="Marcar revisada hoy"
                    className="shrink-0 text-muted-foreground"
                  >
                    <CheckCheck aria-hidden="true" />{checkingId === point.id ? "…" : "Revisada"}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
