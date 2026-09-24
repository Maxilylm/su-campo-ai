import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A chart on one card surface: title, one-line description, optional legend or
 * view switch on the right. */
export function ChartPanel({ title, titleId, description, aside, children, className }: {
  title: ReactNode;
  titleId: string;
  description?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section aria-labelledby={titleId} className={cn("min-w-0 rounded-lg border border-border bg-card p-4", className)}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h3 id={titleId} className="text-sm font-medium">{title}</h3>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

export interface LegendItem {
  label: string;
  color: string;
  /** "box" for bars, "line" for a line series. */
  shape?: "box" | "line";
}

/** The legend: identity never depends on matching colors alone. */
export function ChartLegend({ items }: { items: LegendItem[] }) {
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className={item.shape === "line" ? "h-0.5 w-3 rounded-full" : "h-2.5 w-2.5 rounded-sm"}
            style={{ background: item.color }}
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/** Shown instead of a chart when there is not enough data: says what to record. */
export function ChartNote({ children }: { children: ReactNode }) {
  return <div className="rounded-md bg-muted/60 px-4 py-6 text-center text-sm text-muted-foreground">{children}</div>;
}
