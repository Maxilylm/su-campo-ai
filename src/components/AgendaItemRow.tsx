"use client";

import Link from "next/link";
import { Check, CheckSquare, ChevronRight, Syringe, Wheat } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AgendaItem } from "@/lib/agenda";

const KIND_ICON = { task: CheckSquare, vaccination: Syringe, harvest: Wheat } as const;
const KIND_COLOR = {
  task: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
  vaccination: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
  harvest: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
} as const;

function relativeDate(item: AgendaItem): string {
  if (item.daysFromNow < 0) return `Atrasado ${Math.abs(item.daysFromNow)}d`;
  if (item.daysFromNow === 0) return "Hoy";
  if (item.daysFromNow === 1) return "Mañana";
  return `En ${item.daysFromNow} días`;
}

export function AgendaItemRow({
  item,
  compact = false,
  onComplete,
  completing = false,
  readOnly = false,
}: {
  item: AgendaItem;
  compact?: boolean;
  onComplete?: (item: AgendaItem) => void;
  completing?: boolean;
  readOnly?: boolean;
}) {
  const Icon = KIND_ICON[item.kind];
  return (
    <div className={compact
      ? "flex items-center gap-2 border-t border-border px-4 py-3 first:border-t-0"
      : "flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-3"}>
      <Link href={item.href} className="flex min-w-0 flex-1 items-center gap-3 transition-colors hover:opacity-80">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${KIND_COLOR[item.kind]}`}>
          <Icon className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{item.title}</span>
          <span className="block truncate text-xs text-muted-foreground">{item.detail}</span>
        </span>
        {compact ? (
          <span className={`shrink-0 text-xs ${item.daysFromNow < 0 ? "font-medium text-red-600 dark:text-red-400" : "text-muted-foreground"}`}>{relativeDate(item)}</span>
        ) : (
          <>
            {item.priority === "high" && <Badge variant="destructive" className="shrink-0">Alta</Badge>}
            {item.daysFromNow < 0 && <Badge variant="destructive" className="shrink-0">{Math.abs(item.daysFromNow)}d atrasado</Badge>}
          </>
        )}
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </Link>
      {item.kind === "task" && onComplete && (
        <Button
          variant="ghost"
          size={compact ? "icon" : "sm"}
          aria-label="Marcar tarea como hecha"
          title={readOnly ? "Necesitás conexión para completar la tarea" : "Marcar tarea como hecha"}
          onClick={() => onComplete(item)}
          disabled={readOnly || completing}
          className="shrink-0"
        >
          <Check className="h-4 w-4" />
          {!compact && <span className="hidden sm:inline">Hecha</span>}
        </Button>
      )}
    </div>
  );
}
