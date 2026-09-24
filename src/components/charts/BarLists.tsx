import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { GAIN_COLOR, LOSS_COLOR, SERIES_COLOR } from "./chart-theme";

// Horizontal bar charts drawn as HTML: the label and exact value of every row
// are real text (the chart is its own text alternative), long names wrap
// instead of colliding, and they reflow to phone width without a canvas.

export interface BarListRow {
  key: string;
  label: string;
  value: number;
  /** Formatted value shown at the end of the row, e.g. "1.200 USD". */
  valueText: ReactNode;
  /** Muted text after the value, e.g. "38 %". */
  aside?: ReactNode;
  detail?: ReactNode;
}

/** One series, magnitudes from a common zero baseline, largest first. */
export function BarList({ rows, label, color = SERIES_COLOR, className }: {
  rows: BarListRow[];
  label: string;
  /** CSS color of the bars; the series identity, e.g. the expense color. */
  color?: string;
  className?: string;
}) {
  const max = Math.max(...rows.map((row) => row.value), 0);
  return (
    <ul aria-label={label} className={cn("space-y-3", className)}>
      {rows.map((row) => (
        <li key={row.key}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 break-words">{row.label}</span>
            <span className="shrink-0 text-right">
              {row.valueText}
              {row.aside && <span className="figure ml-2 inline-block min-w-[3ch] text-xs text-muted-foreground">{row.aside}</span>}
            </span>
          </div>
          <div className="mt-1.5 h-2" aria-hidden="true">
            <div
              className="h-2 rounded-r-[4px]"
              style={{ width: `${max > 0 ? Math.max((row.value / max) * 100, 1) : 0}%`, background: color }}
            />
          </div>
          {row.detail && <p className="mt-1 text-xs text-muted-foreground">{row.detail}</p>}
        </li>
      ))}
    </ul>
  );
}

/** Values above and below zero from a shared center axis: gains to the right in
 * the ok tone, losses to the left in the bad tone. The signed value text carries
 * the direction too, so color is never the only cue. */
export function DivergingBarList({ rows, label, className }: { rows: BarListRow[]; label: string; className?: string }) {
  const max = Math.max(...rows.map((row) => Math.abs(row.value)), 0);
  return (
    <ul aria-label={label} className={cn("space-y-3", className)}>
      {rows.map((row) => {
        const width = max > 0 && row.value !== 0 ? Math.max((Math.abs(row.value) / max) * 50, 0.75) : 0;
        return (
          <li key={row.key}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 break-words">{row.label}</span>
              <span className="shrink-0 text-right">{row.valueText}</span>
            </div>
            <div className="relative mt-1.5 h-2" aria-hidden="true">
              <span className="absolute inset-y-[-3px] left-1/2 w-px bg-border" />
              {width > 0 && (
                <span
                  className={cn("absolute inset-y-0", row.value > 0 ? "left-1/2 rounded-r-[4px]" : "right-1/2 rounded-l-[4px]")}
                  style={{ width: `${width}%`, background: row.value > 0 ? GAIN_COLOR : LOSS_COLOR }}
                />
              )}
            </div>
            {row.detail && <p className="mt-1 text-xs text-muted-foreground">{row.detail}</p>}
          </li>
        );
      })}
    </ul>
  );
}
