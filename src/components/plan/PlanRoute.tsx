import { ArrowRightLeft, Check, ChevronRight, ClipboardCheck, CloudRain, Droplets, Loader2, Syringe, Wheat, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PlanItem, PlanItemKind, PlanStop } from "@/lib/daily-plan";
import { taskIdFromAgendaItemId } from "@/lib/agenda";
import { PLAN_KIND_LABELS, PLAN_URGENCY, stopTally, TONE_TEXT } from "@/lib/plan-view";
import { toneTint } from "@/lib/status-styles";
import { cn } from "@/lib/utils";

const KIND_ICONS: Record<PlanItemKind, LucideIcon> = {
  water: Droplets,
  move: ArrowRightLeft,
  vaccination: Syringe,
  task: ClipboardCheck,
  harvest: Wheat,
};

// Field actions: a full-width 44px target on a phone, a normal button at a desk.
const ACTION_CLASS = "h-11 flex-1 sm:h-8 sm:flex-none";

interface PlanRouteProps {
  stops: PlanStop[];
  /** Online and allowed to write. */
  canAct: boolean;
  /** Potreros the move dialog can read; "Mover" needs the stop among them. */
  movableSectionIds: Set<string>;
  completingId: string | null;
  onOpen: (href: string) => void;
  onComplete: (item: PlanItem) => void;
  onMove: (sectionId: string, item: PlanItem) => void;
}

/** The day as a numbered route: one stop per potrero, in the order to ride it. */
export function PlanRoute({ stops, canAct, movableSectionIds, completingId, onOpen, onComplete, onMove }: PlanRouteProps) {
  return (
    <ol className="space-y-5">
      {stops.map((stop, index) => {
        const number = index + 1;
        const last = index === stops.length - 1;
        const headingId = `plan-stop-${number}`;
        return (
          <li key={stop.sectionId ?? "general"} aria-labelledby={headingId} className="relative grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3 break-inside-avoid">
            {!last && <span aria-hidden="true" className="absolute bottom-[-1.25rem] left-4 top-9 w-px -translate-x-1/2 bg-border print:hidden" />}
            <span aria-hidden="true" className="figure relative flex h-8 w-8 items-center justify-center rounded-full border-2 border-foreground bg-card text-base font-semibold">
              {number}
            </span>
            <div className="min-w-0">
              <div className="flex min-h-8 flex-wrap items-baseline gap-x-2 gap-y-0.5 pt-1">
                <h3 id={headingId} className="text-base font-semibold">
                  <span className="sr-only">Parada {number}: </span>{stop.name}
                </h3>
                <span className="text-sm text-muted-foreground">
                  {stop.context ? `${stop.context} · ` : ""}{stopTally(stop)}
                </span>
              </div>
              <ul className="mt-2 divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
                {stop.items.map((item) => {
                  const canMove = canAct && item.kind === "move" && stop.sectionId !== null && movableSectionIds.has(stop.sectionId);
                  const canComplete = canAct && item.kind === "task" && Boolean(taskIdFromAgendaItemId(item.id));
                  return (
                    <PlanItemRow
                      key={item.id}
                      item={item}
                      onOpen={() => onOpen(item.href)}
                      action={canMove ? (
                        <Button variant="outline" className={ACTION_CLASS} onClick={() => onMove(stop.sectionId!, item)} aria-label={`Mover hacienda de ${stop.name}`}>
                          <ArrowRightLeft aria-hidden="true" />Mover
                        </Button>
                      ) : canComplete ? (
                        <Button variant="outline" className={ACTION_CLASS} disabled={completingId !== null} onClick={() => onComplete(item)} aria-label={`Marcar como hecha: ${item.title}`}>
                          {completingId === item.id ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Check aria-hidden="true" />}Hecho
                        </Button>
                      ) : null}
                    />
                  );
                })}
              </ul>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function PlanItemRow({ item, onOpen, action }: { item: PlanItem; onOpen: () => void; action: React.ReactNode }) {
  const urgency = PLAN_URGENCY[item.urgency];
  const Icon = KIND_ICONS[item.kind];
  const blocked = Boolean(item.blockedBy);
  return (
    <li className="flex flex-col gap-2.5 px-4 py-3 sm:flex-row sm:items-center sm:gap-3">
      <button
        type="button"
        onClick={onOpen}
        className="group flex min-w-0 flex-1 items-start gap-3 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 rounded-md"
      >
        <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-md", toneTint(blocked ? "warn" : urgency.tone))}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn("block font-medium group-hover:underline", blocked && "text-muted-foreground line-through decoration-muted-foreground/60")}>
            {item.title}
          </span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            <span className={cn("font-medium", TONE_TEXT[urgency.tone])}>{urgency.label}</span>
            {" · "}{PLAN_KIND_LABELS[item.kind]}
            {item.detail && <> · {item.detail}</>}
          </span>
          {item.blockedBy && (
            <span className="mt-1 flex items-start gap-1.5 text-xs font-medium text-warn">
              <CloudRain className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              No hoy: {item.blockedBy}
            </span>
          )}
        </span>
        <ChevronRight className="mt-1.5 h-4 w-4 shrink-0 text-muted-foreground print:hidden" aria-hidden="true" />
      </button>
      {action && <div className="flex pl-11 print:hidden sm:pl-0">{action}</div>}
    </li>
  );
}
