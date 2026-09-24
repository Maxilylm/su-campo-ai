"use client";

import { DollarSign, MoreHorizontal, Package, Pencil, Syringe, Trash2 } from "lucide-react";
import { AuthenticatedDownloadLink } from "@/components/AuthenticatedDownloadLink";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { calendarDateLabel, isPastCalendarDate } from "@/lib/date";
import { toneTint } from "@/lib/status-styles";
import { cn } from "@/lib/utils";
import { Notice, noticeLinkClass } from "../Notice";
import { SectionTitle } from "../SectionTitle";
import { recordScope, type Vaccination } from "./types";

export function VaccinationList({
  vaccinations, truncated, today, focusedId, onAdd, onEdit, onExpense, onInventory, onDelete,
}: {
  vaccinations: Vaccination[];
  truncated: boolean;
  /** Farm-local calendar day (YYYY-MM-DD); due today is not overdue. */
  today: string;
  focusedId: string | null;
  onAdd: () => void;
  onEdit: (vaccination: Vaccination) => void;
  onExpense: (vaccination: Vaccination) => void;
  onInventory: (vaccination: Vaccination) => void;
  onDelete: (id: string) => Promise<void>;
}) {
  return (
    <section aria-labelledby="sanidad-vaccinations-title">
      <SectionTitle
        id="sanidad-vaccinations-title"
        title="Vacunaciones"
        meta={truncated ? `${vaccinations.length}+ registros visibles` : `${vaccinations.length} ${vaccinations.length === 1 ? "registro" : "registros"}`}
      />

      {truncated && (
        <Notice tone="warn" className="mb-3">
          Se muestran solo las 100 vacunaciones más recientes. Para ver el historial completo, <AuthenticatedDownloadLink href="/api/export?format=csv&table=vaccinations" filename="campoai-vacunaciones.csv" className={noticeLinkClass}>descargá las vacunaciones en CSV</AuthenticatedDownloadLink>.
        </Notice>
      )}

      {vaccinations.length === 0 ? (
        <EmptyState
          icon={Syringe}
          title="Todavía no hay vacunaciones"
          description="Registrá la primera vacunación para llevar el calendario sanitario al día."
          actionLabel="Registrar vacunación"
          onAction={onAdd}
        />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
          {vaccinations.map((v) => {
            const overdue = isPastCalendarDate(v.next_due, today);
            const scope = recordScope(v);
            return (
              <li
                id={`sanidad-vaccination-${v.id}`}
                key={v.id}
                className={cn("flex items-start gap-3 px-4 py-3 sm:items-center", focusedId === v.id && "bg-accent ring-2 ring-inset ring-primary/40")}
              >
                <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md sm:mt-0", toneTint(overdue ? "bad" : "neutral"))}>
                  <Syringe className="h-4 w-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-medium">{v.vaccine_name}</span>
                    {overdue && <Badge variant="bad">Vencida</Badge>}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Aplicada el {calendarDateLabel(v.date_applied)}
                    {v.next_due && <> · <span className={overdue ? "font-medium text-bad" : undefined}>Próxima: {calendarDateLabel(v.next_due)}</span></>}
                    {scope && <> · {scope}</>}
                    {v.applied_by && <> · {v.applied_by}</>}
                    {v.batch_number && <> · Lote {v.batch_number}</>}
                  </p>
                </div>
                <span className="shrink-0 self-center text-right">
                  <span className="figure text-lg font-semibold">{v.head_count.toLocaleString("es-UY")}</span>
                  <span className="ml-1 text-xs text-muted-foreground">cab.</span>
                </span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label={`Acciones de ${v.vaccine_name}`} className="shrink-0 self-center">
                      <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => onEdit(v)}>
                      <Pencil className="mr-2 h-4 w-4" aria-hidden="true" />Editar
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onExpense(v)}>
                      <DollarSign className="mr-2 h-4 w-4" aria-hidden="true" />Registrar gasto
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onInventory(v)}>
                      <Package className="mr-2 h-4 w-4" aria-hidden="true" />Registrar uso de insumo
                    </DropdownMenuItem>
                    <ConfirmDialog
                      trigger={<DropdownMenuItem onSelect={(event) => event.preventDefault()} className="text-destructive"><Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />Eliminar</DropdownMenuItem>}
                      title="Eliminar vacunación"
                      description={`Esto eliminará el registro de ${v.vaccine_name}. Esta acción no se puede deshacer.`}
                      onConfirm={() => { void onDelete(v.id); }}
                    />
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
