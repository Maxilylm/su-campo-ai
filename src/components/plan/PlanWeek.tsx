import { ChevronRight, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SupplyCheck, WeekDay } from "@/lib/week-prep";
import { SUPPLY_STATUS, TONE_TEXT, weekdayLabel } from "@/lib/plan-view";
import { toneTint } from "@/lib/status-styles";
import { cn } from "@/lib/utils";

export type PlanWeekItem = { id: string; kind: string; title: string; detail: string; href: string; date: string };

/** "Esta semana": supplies to have ready and what comes after the next two days. */
export function PlanWeek({ supplies, week, canBuy, onOpen }: {
  supplies: SupplyCheck[];
  week: WeekDay<PlanWeekItem>[];
  canBuy: boolean;
  onOpen: (href: string) => void;
}) {
  if (supplies.length === 0 && week.length === 0) return null;
  return (
    <section aria-labelledby="week-title" className="break-inside-avoid">
      <h2 id="week-title" className="mb-3 text-base font-semibold">Esta semana</h2>
      <div className="grid gap-6 lg:grid-cols-2">
        {supplies.length > 0 && (
          <div className="min-w-0">
            <h3 className="mb-2 text-sm font-medium text-muted-foreground">Insumos para vacunar</h3>
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
              {supplies.map((check) => {
                const status = SUPPLY_STATUS[check.status];
                return (
                  <li key={check.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-md", toneTint(status.tone))}>
                      <Package className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm">{check.summary}</span>
                      <span className={cn("block text-xs font-medium", TONE_TEXT[status.tone])}>{status.label}</span>
                    </span>
                    {check.status !== "ok" && canBuy && (
                      <Button variant="outline" size="sm" className="print:hidden" onClick={() => onOpen("/gestion/inventario")}>Ir a inventario</Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {week.length > 0 && (
          <div className="min-w-0">
            <h3 className="mb-2 text-sm font-medium text-muted-foreground">Más adelante</h3>
            <ol className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
              {week.map((day) => (
                <li key={day.date} className="px-4 py-3">
                  <p className="text-sm font-medium">{weekdayLabel(day.date)}</p>
                  <ul className="mt-1 space-y-0.5">
                    {day.items.map((item) => (
                      <li key={item.id}>
                        <button type="button" onClick={() => onOpen(item.href)} className="group flex w-full items-start gap-1 rounded-sm py-1 text-left text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground focus-visible:underline">
                          <span className="min-w-0 flex-1">{item.title}{item.detail ? ` · ${item.detail}` : ""}</span>
                          <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 print:hidden" aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </section>
  );
}
