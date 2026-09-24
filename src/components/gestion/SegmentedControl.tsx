"use client";

import { type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: LucideIcon;
}

/** A row of toggle buttons for one filter. Scrolls sideways on narrow screens
 * instead of widening the page. */
export function SegmentedControl<T extends string>({ label, options, value, onChange, className }: {
  /** Accessible name of the group, e.g. "Período". */
  label: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cn("-mx-1 flex max-w-full gap-1 overflow-x-auto px-1 py-0.5", className)}>
      {options.map((option) => {
        const active = option.value === value;
        const Icon = option.icon;
        return (
          <button
            type="button"
            key={option.value}
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-3 text-sm transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
              active
                ? "border-border bg-card font-medium text-foreground shadow-xs"
                : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {Icon && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
