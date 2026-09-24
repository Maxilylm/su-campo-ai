"use client";

import { DollarSign, Heart, MoreHorizontal, Package, Pencil, Stethoscope, Trash2 } from "lucide-react";
import { AuthenticatedDownloadLink } from "@/components/AuthenticatedDownloadLink";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toneTint } from "@/lib/status-styles";
import { cn } from "@/lib/utils";
import { Notice, noticeLinkClass } from "../Notice";
import { SectionTitle } from "../SectionTitle";
import { HEALTH_ICON, HEALTH_TYPES, STATUS_OPTIONS, recordScope, type HealthEvent } from "./types";

const TYPE_LABEL = Object.fromEntries(HEALTH_TYPES.map((type) => [type.value, type.label]));

export function HealthEventList({
  events, truncated, focusedId, onAdd, onEdit, onExpense, onInventory, onDelete, onStatusChange,
}: {
  events: HealthEvent[];
  truncated: boolean;
  focusedId: string | null;
  onAdd: () => void;
  onEdit: (event: HealthEvent) => void;
  onExpense: (event: HealthEvent) => void;
  onInventory: (event: HealthEvent) => void;
  onDelete: (id: string) => Promise<void>;
  onStatusChange: (id: string, status: string) => Promise<void>;
}) {
  return (
    <section aria-labelledby="sanidad-health-title">
      <SectionTitle
        id="sanidad-health-title"
        title="Eventos de salud"
        meta={truncated ? `${events.length}+ registros visibles` : `${events.length} ${events.length === 1 ? "registro" : "registros"}`}
      />

      {truncated && (
        <Notice tone="warn" className="mb-3">
          Se muestran solo los 100 eventos más recientes. Para ver el historial completo, <AuthenticatedDownloadLink href="/api/export?format=csv&table=health_events" filename="campoai-sanidad.csv" className={noticeLinkClass}>descargá Sanidad en CSV</AuthenticatedDownloadLink>.
        </Notice>
      )}

      {events.length === 0 ? (
        <EmptyState
          icon={Heart}
          title="Todavía no hay eventos de salud"
          description="Registrá nacimientos, muertes, enfermedades y tratamientos para tener la historia de cada lote."
          actionLabel="Registrar evento"
          onAction={onAdd}
        />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
          {events.map((h) => {
            const Icon = HEALTH_ICON[h.type] || Stethoscope;
            const status = h.resolved ? "resolved" : "pending";
            const scope = recordScope(h);
            return (
              <li
                id={`sanidad-health-${h.id}`}
                key={h.id}
                className={cn("flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center", focusedId === h.id && "bg-accent ring-2 ring-inset ring-primary/40")}
              >
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md", toneTint(h.resolved ? "neutral" : "warn"))}>
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{h.description}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {TYPE_LABEL[h.type] || h.type} · {new Date(h.date_occurred).toLocaleDateString("es-AR")}
                      {" · "}<span className="figure text-foreground">{h.head_count}</span> cab.
                      {scope && <> · {scope}</>}
                      {h.veterinarian && <> · Vet.: {h.veterinarian}</>}
                      {h.notes && <> · {h.notes}</>}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1 pl-11 sm:pl-0">
                  <Select value={status} onValueChange={(value) => onStatusChange(h.id, value)}>
                    <SelectTrigger size="sm" aria-label={`Estado de ${h.description}`} className={cn("w-[128px] text-xs", !h.resolved && "text-warn")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label={`Acciones de ${h.description}`}>
                        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onEdit(h)}>
                        <Pencil className="mr-2 h-4 w-4" aria-hidden="true" />Editar
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onExpense(h)}>
                        <DollarSign className="mr-2 h-4 w-4" aria-hidden="true" />Registrar gasto
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onInventory(h)}>
                        <Package className="mr-2 h-4 w-4" aria-hidden="true" />Registrar uso de insumo
                      </DropdownMenuItem>
                      <ConfirmDialog
                        trigger={<DropdownMenuItem onSelect={(event) => event.preventDefault()} className="text-destructive"><Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />Eliminar</DropdownMenuItem>}
                        title="Eliminar evento de salud"
                        description={`Esto eliminará el evento "${h.description}". Esta acción no se puede deshacer.`}
                        onConfirm={() => { void onDelete(h.id); }}
                      />
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
