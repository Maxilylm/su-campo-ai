"use client";

import { type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type StatTone = "ok" | "warn" | "bad";

const TONE_CLASSES: Record<StatTone, string> = { ok: "text-ok", warn: "text-warn", bad: "text-bad" };

interface StatCardProps {
  label: string;
  value: number | string;
  /** Unit shown small after the figure: "cab.", "ha", "kg". */
  unit?: string;
  /** Color only when the number is a state worth noticing. */
  tone?: StatTone;
  /** @deprecated Decorative hues were removed; use `tone` for meaning. */
  accent?: string;
  icon?: LucideIcon;
  className?: string;
}

export function StatCard({ label, value, unit, tone, icon: Icon, className }: StatCardProps) {
  return (
    <div className={cn("rounded-lg border border-border bg-card px-4 py-3.5", className)}>
      <div className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
        {Icon && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
        <span className="truncate">{label}</span>
      </div>
      <div className={cn("figure mt-2.5 text-[1.75rem] font-semibold", tone ? TONE_CLASSES[tone] : "text-foreground")}>
        {value}
        {unit && <span className="ml-1 text-sm font-normal tracking-normal text-muted-foreground">{unit}</span>}
      </div>
    </div>
  );
}

/** Readouts on one surface, divided by hairlines — the farm at a glance. */
export function StatStrip({ items, className }: {
  items: { label: string; value: number | string; unit?: string; tone?: StatTone; hint?: string }[];
  className?: string;
}) {
  return (
    <dl className={cn("grid grid-cols-2 overflow-hidden rounded-lg border border-border bg-card sm:grid-flow-col sm:auto-cols-fr sm:grid-cols-none", className)}>
      {items.map((item) => (
        <div key={item.label} className="border-border px-4 py-3.5 [&:not(:first-child)]:border-t sm:[&:not(:first-child)]:border-l sm:[&:not(:first-child)]:border-t-0 max-sm:[&:nth-child(2)]:border-t-0 max-sm:[&:nth-child(even)]:border-l">
          <dt className="text-[13px] text-muted-foreground">{item.label}</dt>
          <dd className={cn("figure mt-2 text-[2rem] font-semibold", item.tone ? TONE_CLASSES[item.tone] : "text-foreground")}>
            {item.value}
            {item.unit && <span className="ml-1 text-sm font-normal tracking-normal text-muted-foreground">{item.unit}</span>}
          </dd>
          {item.hint && <p className="mt-1.5 truncate text-xs text-muted-foreground">{item.hint}</p>}
        </div>
      ))}
    </dl>
  );
}
