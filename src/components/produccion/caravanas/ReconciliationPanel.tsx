"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { reconcileLotes, type ReconciliationState } from "@/lib/caravanas";
import { SectionTitle } from "../SectionTitle";
import type { LoteOption } from "./types";

const COLLAPSED_ROWS = 8;
/** Mismatches first: they are what needs attention. */
const STATE_ORDER: Record<ReconciliationState, number> = { sobran: 0, faltan: 1, sin_caravanas: 2, ok: 3 };

const STATE: Record<ReconciliationState, { label: string; variant: "ok" | "warn" | "bad" | "muted" }> = {
  ok: { label: "Coincide", variant: "ok" },
  faltan: { label: "Faltan caravanas", variant: "warn" },
  sobran: { label: "Más caravanas que cabezas", variant: "bad" },
  sin_caravanas: { label: "Sin caravanas", variant: "muted" },
};

/** Heads per lote vs active caravanas assigned to it; a row filters the list. */
export function ReconciliationPanel({
  lotes, byCattle, lotesTruncated, activeLoteId, onSelectLote,
}: {
  lotes: LoteOption[];
  byCattle: Record<string, number>;
  lotesTruncated: boolean;
  activeLoteId: string;
  onSelectLote: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (lotes.length === 0) return null;
  const rows = reconcileLotes(lotes, byCattle)
    .sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || b.count - a.count);
  const matching = rows.filter((row) => row.state === "ok").length;
  const visible = expanded ? rows : rows.slice(0, COLLAPSED_ROWS);

  return (
    <section aria-labelledby="caravanas-reconciliation-title">
      <SectionTitle
        id="caravanas-reconciliation-title"
        title="Conciliación por lote"
        meta={<>{matching} de {rows.length}{lotesTruncated ? "+" : ""} {rows.length === 1 ? "lote coincide" : "lotes coinciden"}</>}
      />
      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
        {visible.map((row) => {
          const state = STATE[row.state];
          const active = activeLoteId === row.id;
          return (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => onSelectLote(active ? "" : row.id)}
                aria-pressed={active}
                className={active
                  ? "flex min-h-11 w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 bg-accent px-4 py-2.5 text-left text-sm"
                  : "flex min-h-11 w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2.5 text-left text-sm hover:bg-accent/60"}
              >
                <span className="min-w-0">
                  <span className="font-medium">{row.label}</span>
                  <span className="block text-xs text-muted-foreground">
                    <span className="figure text-foreground">{row.count.toLocaleString("es-UY")}</span> {row.count === 1 ? "cabeza" : "cabezas"}, <span className="figure text-foreground">{row.tagged.toLocaleString("es-UY")}</span> {row.tagged === 1 ? "caravana asignada" : "caravanas asignadas"}
                    {row.state === "faltan" && <> · faltan {row.difference.toLocaleString("es-UY")}</>}
                    {row.state === "sobran" && <> · sobran {Math.abs(row.difference).toLocaleString("es-UY")}</>}
                  </span>
                </span>
                <Badge variant={state.variant}>{state.label}</Badge>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">Cuenta solo caravanas activas. Tocá un lote para ver sus caravanas.</p>
        {rows.length > COLLAPSED_ROWS && (
          <Button variant="ghost" size="sm" onClick={() => setExpanded((value) => !value)}>
            {expanded ? "Ver menos" : `Ver los ${rows.length} lotes`}
          </Button>
        )}
      </div>
    </section>
  );
}
