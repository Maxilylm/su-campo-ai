"use client";

import Link from "next/link";
import { CalendarPlus, Check, CheckSquare, ChevronRight, Syringe, Wheat } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AgendaItem } from "@/lib/agenda";
import { toneTint, type Tone } from "@/lib/status-styles";
import { cn } from "@/lib/utils";

const KIND_ICON = { task: CheckSquare, vaccination: Syringe, harvest: Wheat } as const;

// Color is the item's state, not its kind: overdue, due today, or later.
function dueTone(item: AgendaItem): Tone {
  if (item.daysFromNow < 0) return "bad";
  if (item.daysFromNow === 0) return "warn";
  return "neutral";
}

function relativeDate(item: AgendaItem): string {
  if (item.daysFromNow < 0) return `${Math.abs(item.daysFromNow)} ${Math.abs(item.daysFromNow) === 1 ? "día" : "días"} de atraso`;
  if (item.daysFromNow === 0) return "Hoy";
  if (item.daysFromNow === 1) return "Mañana";
  return `En ${item.daysFromNow} días`;
}

// Icon-only square on a phone, labelled at sm+; 36px keeps it tappable.
const ROW_ACTION = "h-9 w-9 shrink-0 px-0 sm:h-8 sm:w-auto sm:px-2.5";

/** One agenda entry as a row of a divided list; the parent owns the surface. */
export function AgendaItemRow({
  item,
  compact = false,
  onComplete,
  completing = false,
  onSnooze,
  snoozing = false,
  readOnly = false,
}: {
  item: AgendaItem;
  compact?: boolean;
  onComplete?: (item: AgendaItem) => void;
  completing?: boolean;
  onSnooze?: (item: AgendaItem) => void;
  snoozing?: boolean;
  readOnly?: boolean;
}) {
  const Icon = KIND_ICON[item.kind];
  const overdue = item.daysFromNow < 0;
  const snoozeLabel = item.daysFromNow <= 0 ? "Mañana" : "+1 día";
  return (
    <div className="flex items-center gap-2 px-4 py-3">
      <Link href={item.href} className="group flex min-w-0 flex-1 items-center gap-3 rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
        <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-md", toneTint(dueTone(item)))}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium group-hover:underline">{item.title}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {(compact || overdue) && <span className={cn(overdue ? "font-medium text-bad" : undefined)}>{relativeDate(item)}{item.detail ? " · " : ""}</span>}
            {item.detail}
          </span>
        </span>
        {!compact && item.priority === "high" && <Badge variant="warn">Prioridad alta</Badge>}
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </Link>
      {item.kind === "task" && onComplete && (
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Hecha: ${item.title}`}
          title={readOnly ? "Necesitás conexión para completar la tarea" : "Marcar tarea como hecha"}
          onClick={() => onComplete(item)}
          disabled={readOnly || completing}
          className={ROW_ACTION}
        >
          <Check aria-hidden="true" />
          <span className="hidden sm:inline">Hecha</span>
        </Button>
      )}
      {item.kind === "task" && onSnooze && (
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Postergar a ${snoozeLabel === "Mañana" ? "mañana" : "+1 día"}: ${item.title}`}
          title={readOnly ? "Necesitás conexión para postergar la tarea" : "Postergar tarea un día"}
          onClick={() => onSnooze(item)}
          disabled={readOnly || snoozing || completing}
          className={ROW_ACTION}
        >
          <CalendarPlus className={snoozing ? "animate-pulse" : undefined} aria-hidden="true" />
          <span className="hidden sm:inline">{snoozeLabel}</span>
        </Button>
      )}
    </div>
  );
}
