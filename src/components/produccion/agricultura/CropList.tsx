"use client";

import { DollarSign, Layers, MoreHorizontal, Pencil, Sprout, Trash2, Wheat } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cropStatusTone } from "@/lib/agricultura-form";
import { calendarDateLabel, isPastCalendarDate } from "@/lib/date";
import { cn } from "@/lib/utils";
import { SectionTitle } from "../SectionTitle";
import { STATUS_LABELS, optionLabel, type Crop } from "./types";

const dateLabel = (value: string) => calendarDateLabel(value);

export function CropList({
  crops, totalCount, truncated, filtered, today, focusedCropId, focusedApplicationId,
  onAdd, onClearFilter, onEdit, onAddApplication, onInventory, onCost, onDelete,
}: {
  crops: Crop[];
  totalCount: number;
  truncated: boolean;
  filtered: boolean;
  /** Farm-local calendar day (YYYY-MM-DD) to flag late harvests. */
  today: string;
  focusedCropId: string | null;
  focusedApplicationId: string | null;
  onAdd: () => void;
  onClearFilter: () => void;
  onEdit: (crop: Crop) => void;
  onAddApplication: (cropId: string) => void;
  onInventory: (crop: Crop) => void;
  onCost: (crop: Crop) => void;
  onDelete: (id: string) => Promise<void>;
}) {
  return (
    <section aria-labelledby="agriculture-crops-title">
      <SectionTitle
        id="agriculture-crops-title"
        title="Cultivos"
        meta={<>{crops.length}{filtered ? ` de ${totalCount}` : ""}{truncated ? "+ registros visibles" : crops.length === 1 && !filtered ? " registro" : " registros"}</>}
      />

      {crops.length === 0 ? (
        <EmptyState
          icon={Wheat}
          title={filtered ? "Sin cultivos en esta sección" : "Todavía no hay cultivos"}
          description={filtered ? "Probá con otra sección o volvé a ver todos los cultivos." : "Cargá tu primer cultivo para seguir siembra, aplicaciones y cosecha."}
          actionLabel={filtered ? "Ver todos" : "Nuevo cultivo"}
          onAction={filtered ? onClearFilter : onAdd}
        />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
          {crops.map((c) => {
            const lateHarvest = Boolean(c.expected_harvest) && !c.actual_harvest && c.status !== "failed" && c.status !== "harvested"
              && isPastCalendarDate(c.expected_harvest, today);
            const applications = c.crop_applications || [];
            const meta = [
              c.sections?.name,
              c.planting_date && `Siembra ${dateLabel(c.planting_date)}`,
              c.soil_type && `Suelo ${c.soil_type}`,
              c.irrigation_type && `Riego ${optionLabel(c.irrigation_type).toLowerCase()}`,
            ].filter(Boolean).join(" · ");
            return (
              <li
                id={`agriculture-crop-${c.id}`}
                key={c.id}
                className={cn("px-4 py-3.5", focusedCropId === c.id && "bg-accent ring-2 ring-inset ring-primary/40")}
              >
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-medium">{optionLabel(c.crop_type)}</span>
                      {c.variety && <span className="text-sm text-muted-foreground">{c.variety}</span>}
                      <Badge variant={cropStatusTone(c.status)}>{STATUS_LABELS[c.status] || c.status}</Badge>
                    </div>
                    {meta && <p className="mt-0.5 text-xs text-muted-foreground">{meta}</p>}
                    <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                      {c.expected_harvest && !c.actual_harvest && (
                        <span className={lateHarvest ? "font-medium text-warn" : undefined}>
                          {lateHarvest ? "Cosecha atrasada" : "Cosecha"}: {dateLabel(c.expected_harvest)}
                        </span>
                      )}
                      {c.actual_harvest && <span>Cosechado {dateLabel(c.actual_harvest)}</span>}
                      {c.yield_kg != null && <span><span className="figure text-foreground">{c.yield_kg.toLocaleString("es-UY")}</span> kg</span>}
                      {c.yield_per_hectare != null && <span><span className="figure text-foreground">{c.yield_per_hectare.toLocaleString("es-UY")}</span> kg/ha</span>}
                    </p>
                    {c.notes && <p className="mt-1 text-xs text-muted-foreground">{c.notes}</p>}
                  </div>
                  {c.planted_hectares ? (
                    <span className="shrink-0 text-right">
                      <span className="figure text-lg font-semibold">{c.planted_hectares.toLocaleString("es-UY")}</span>
                      <span className="ml-1 text-xs text-muted-foreground">ha</span>
                    </span>
                  ) : null}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label={`Acciones de ${c.crop_type}${c.variety ? ` ${c.variety}` : ""}`} className="-mt-0.5 shrink-0">
                        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onEdit(c)}>
                        <Pencil className="mr-2 h-4 w-4" aria-hidden="true" />Editar
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onAddApplication(c.id)}>
                        <Sprout className="mr-2 h-4 w-4" aria-hidden="true" />Agregar aplicación
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onInventory(c)}>
                        <Layers className="mr-2 h-4 w-4" aria-hidden="true" />Registrar uso de insumo
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onCost(c)}>
                        <DollarSign className="mr-2 h-4 w-4" aria-hidden="true" />Registrar gasto del cultivo
                      </DropdownMenuItem>
                      <ConfirmDialog
                        trigger={
                          <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-destructive">
                            <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />Eliminar
                          </DropdownMenuItem>
                        }
                        title="Eliminar cultivo"
                        description={`Esto eliminará el cultivo "${c.crop_type}" y sus aplicaciones. Esta acción no se puede deshacer.`}
                        onConfirm={() => onDelete(c.id)}
                      />
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                {applications.length > 0 && (
                  <div className="mt-3 rounded-md border border-border bg-muted/40">
                    <p className="px-3 pt-2 text-xs font-medium text-muted-foreground">
                      Últimas aplicaciones <span className="font-normal">· {applications.length} en total</span>
                    </p>
                    <ul className="divide-y divide-border">
                      {applications.filter((application, index) => index < 3 || application.id === focusedApplicationId).map((application) => (
                        <li
                          id={`agriculture-application-${application.id}`}
                          key={application.id}
                          className={cn("px-3 py-2 text-xs", focusedApplicationId === application.id && "bg-accent ring-1 ring-inset ring-primary/40")}
                        >
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <span className="font-medium">{application.product_name || optionLabel(application.type)}</span>
                            <span className="text-muted-foreground">{application.type}</span>
                            {application.date_applied && <span className="text-muted-foreground">· {dateLabel(application.date_applied)}</span>}
                          </div>
                          {(application.dose_per_hectare || application.total_applied || application.applied_by) && (
                            <p className="mt-0.5 text-muted-foreground">
                              {[application.dose_per_hectare && `Dosis: ${application.dose_per_hectare}`, application.total_applied && `Total: ${application.total_applied}`, application.applied_by && `Por: ${application.applied_by}`].filter(Boolean).join(" · ")}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                    {applications.length > 3 && <p className="border-t border-border px-3 py-1.5 text-xs text-muted-foreground">+ {applications.length - 3} aplicaciones anteriores</p>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
