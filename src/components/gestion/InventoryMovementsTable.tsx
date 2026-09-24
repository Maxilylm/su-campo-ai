"use client";

import Link from "next/link";
import { ArrowUpFromLine, AlertTriangle } from "lucide-react";
import { AuthenticatedDownloadLink } from "@/components/AuthenticatedDownloadLink";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { Quantity } from "./Figures";
import { Notice } from "./Notice";
import { MOVEMENT_LABELS, type InventoryMovement } from "./inventory-types";

const HEAD = "h-9 text-xs font-medium text-muted-foreground";

export function InventoryMovementsTable({ movements, truncated, loadError, offlineReadOnly, focusedMovementId, onRetry }: {
  movements: InventoryMovement[];
  truncated: boolean;
  loadError: boolean;
  offlineReadOnly: boolean;
  focusedMovementId: string | null;
  onRetry: () => void;
}) {
  return (
    <section aria-labelledby="inventory-movements-title" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div>
          <h2 id="inventory-movements-title" className="text-base font-semibold">Movimientos recientes</h2>
          <p className="text-sm text-muted-foreground">Compras, usos, ajustes y pérdidas que explican el stock actual.</p>
        </div>
        <span className="text-xs text-muted-foreground">
          <span className="figure">{movements.length}{truncated ? "+" : ""}</span> {truncated ? "registros visibles" : "registros"}
        </span>
      </div>
      {truncated && (
        <Notice>
          Se muestran los 100 movimientos más recientes. Para ver el historial completo,{" "}
          <AuthenticatedDownloadLink href="/api/export?format=csv&table=inventory_movements" filename="campoai-movimientos-inventario.csv" className="font-medium text-primary underline-offset-2 hover:underline">descargá los movimientos (CSV)</AuthenticatedDownloadLink>.
        </Notice>
      )}
      {loadError ? (
        <Notice
          tone="warn"
          icon={AlertTriangle}
          role={offlineReadOnly ? "status" : "alert"}
          action={!offlineReadOnly && <Button variant="outline" size="sm" onClick={onRetry}>Reintentar</Button>}
        >
          {offlineReadOnly
            ? "No hay una copia local del historial de movimientos. Sincronizá Inventario desde Mi campo cuando recuperes la conexión."
            : "No se pudo cargar el historial de movimientos. Revisá tu conexión y reintentá."}
        </Notice>
      ) : movements.length === 0 ? (
        <EmptyState icon={ArrowUpFromLine} title="Todavía no hay movimientos" description="Las compras, usos y ajustes van a aparecer acá cuando registres el primero." />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className={cn(HEAD, "pl-4")}>Fecha</TableHead>
                <TableHead className={HEAD}>Movimiento</TableHead>
                <TableHead className={HEAD}>Insumo</TableHead>
                <TableHead className={cn(HEAD, "text-right")}>Cantidad</TableHead>
                <TableHead className={HEAD}>Contexto</TableHead>
                <TableHead className={cn(HEAD, "pr-4")}>Notas</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {movements.map((movement) => {
                const quantity = Number(movement.quantity);
                const positive = quantity > 0;
                return (
                  <TableRow id={`inventory-movement-${movement.id}`} key={movement.id} className={focusedMovementId === movement.id ? "bg-accent" : undefined}>
                    <TableCell className="py-3 pl-4 text-muted-foreground"><span className="figure">{new Date(`${movement.date}T12:00:00`).toLocaleDateString("es-UY")}</span></TableCell>
                    <TableCell>{MOVEMENT_LABELS[movement.type] || movement.type}</TableCell>
                    <TableCell className="max-w-[12rem] truncate font-medium">{movement.inventory_items?.name || "Insumo eliminado"}</TableCell>
                    <TableCell className="text-right font-semibold">
                      <Quantity value={`${positive ? "+" : quantity < 0 ? "−" : ""}${Math.abs(quantity)}`} unit={movement.inventory_items?.unit} />
                    </TableCell>
                    <TableCell className="max-w-[220px] text-xs">
                      <div className="flex flex-wrap gap-x-2 gap-y-1">
                        {movement.sections?.name && movement.section_id && (
                          <Link href={`/produccion/hacienda?sectionId=${encodeURIComponent(movement.section_id)}`} className="text-primary hover:underline">
                            Sección: {movement.sections.name}
                          </Link>
                        )}
                        {movement.crops?.crop_type && movement.crop_id && (
                          <Link href={`/produccion/agricultura?cropId=${encodeURIComponent(movement.crop_id)}`} className="text-primary hover:underline">
                            Cultivo: {movement.crops.crop_type}
                          </Link>
                        )}
                        {movement.cattle?.category && movement.cattle_id && (
                          <Link href={`/produccion/hacienda?cattleId=${encodeURIComponent(movement.cattle_id)}`} className="text-primary hover:underline">
                            Lote: {movement.cattle.category}
                          </Link>
                        )}
                        {!movement.section_id && !movement.crop_id && !movement.cattle_id && <span className="text-muted-foreground">Sin asignar</span>}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[240px] truncate pr-4 text-xs text-muted-foreground">{movement.notes || "—"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
