"use client";

import { type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const ACCENT_CLASSES: Record<string, string> = {
  emerald: "text-emerald-600 dark:text-emerald-400",
  blue: "text-blue-600 dark:text-blue-400",
  amber: "text-amber-600 dark:text-amber-400",
  red: "text-red-600 dark:text-red-400",
  purple: "text-purple-600 dark:text-purple-400",
};

interface StatCardProps {
  label: string;
  value: number | string;
  accent?: string;
  icon?: LucideIcon;
}

export function StatCard({ label, value, accent = "emerald", icon: Icon }: StatCardProps) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
      </div>
      <div className={cn("text-2xl font-bold tabular-nums", ACCENT_CLASSES[accent] || ACCENT_CLASSES.emerald)}>
        {value}
      </div>
    </div>
  );
}
