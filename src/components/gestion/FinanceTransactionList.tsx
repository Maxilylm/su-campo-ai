"use client";

import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, DollarSign, MoreHorizontal, Package, Pencil, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { Money } from "./Figures";
import { financeCategoryLabel, type Transaction } from "./finance-types";

function formatDay(date: string): string {
  const parsed = new Date(`${date}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? date : parsed.toLocaleDateString("es-UY");
}

export function FinanceTransactionList({
  transactions, totalCount, hasActiveFilters, focusedTransactionId, onNew, onClearFilters, onEdit, onDelete,
}: {
  transactions: Transaction[];
  /** All loaded transactions, before the section/currency filters. */
  totalCount: number;
  hasActiveFilters: boolean;
  focusedTransactionId: string | null;
  onNew: () => void;
  onClearFilters: () => void;
  onEdit: (transaction: Transaction) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <section aria-labelledby="finance-transactions-title" className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="finance-transactions-title" className="text-base font-semibold">Movimientos</h2>
        <span className="text-xs text-muted-foreground">
          <span className="figure">{transactions.length}</span>{hasActiveFilters ? <> de <span className="figure">{totalCount}</span></> : ""} registros
        </span>
      </div>

      {transactions.length === 0 ? (
        <EmptyState
          icon={DollarSign}
          title={totalCount === 0 ? "Todavía no hay movimientos en este período" : "No hay movimientos con estos filtros"}
          description={totalCount === 0 ? "Cargá tu primer ingreso o egreso, o elegí un período más largo." : "Probá con otra sección o moneda para ver los movimientos disponibles."}
          actionLabel={totalCount === 0 ? "Nuevo movimiento" : "Limpiar filtros"}
          onAction={totalCount === 0 ? onNew : onClearFilters}
        />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
          {transactions.map((tx) => {
            const income = tx.type === "ingreso";
            const DirectionIcon = income ? ArrowDownLeft : ArrowUpRight;
            return (
              <li
                id={`financial-transaction-${tx.id}`}
                key={tx.id}
                className={cn("flex items-center gap-3 px-4 py-3 transition-colors", focusedTransactionId === tx.id && "bg-accent")}
              >
                <span className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground sm:flex">
                  <DirectionIcon className="h-4 w-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{tx.description || financeCategoryLabel(tx.category)}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-muted-foreground">
                    <span className="sr-only">{income ? "Ingreso" : "Egreso"}.</span>
                    <span className="figure">{formatDay(tx.date)}</span>
                    <span>{financeCategoryLabel(tx.category)}</span>
                    {tx.contextOnly && <Badge variant="muted">Fuera del período</Badge>}
                    {tx.sections?.name && tx.section_id && (
                      <Link href={`/produccion/hacienda?sectionId=${encodeURIComponent(tx.section_id)}`} className="text-primary hover:underline">
                        Sección: {tx.sections.name}
                      </Link>
                    )}
                    {tx.crops?.crop_type && tx.crop_id && (
                      <Link href={`/produccion/agricultura?cropId=${encodeURIComponent(tx.crop_id)}`} className="text-primary hover:underline">
                        Cultivo: {tx.crops.crop_type}
                      </Link>
                    )}
                    {tx.cattle && tx.cattle_id && (
                      <Link href={`/produccion/hacienda?cattleId=${encodeURIComponent(tx.cattle_id)}`} className="text-primary hover:underline">
                        Lote: {tx.cattle.category}
                      </Link>
                    )}
                    {tx.inventory_movement_id && (
                      <Link href={`/gestion/inventario?movementId=${encodeURIComponent(tx.inventory_movement_id)}`} className="text-primary hover:underline">
                        Ver stock
                      </Link>
                    )}
                  </p>
                </div>
                <Money amount={tx.amount} currency={tx.currency} sign={income ? "+" : "-"} className="shrink-0 text-right text-[15px] font-semibold" />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label={`Acciones para ${tx.description || financeCategoryLabel(tx.category)}`} className="-mr-2 shrink-0"><MoreHorizontal className="h-4 w-4" /></Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {tx.inventory_movement_id ? (
                      <DropdownMenuItem asChild>
                        <Link href={`/gestion/inventario?movementId=${encodeURIComponent(tx.inventory_movement_id)}`}>
                          <Package className="mr-2 h-4 w-4" aria-hidden="true" />Gestionar desde Inventario
                        </Link>
                      </DropdownMenuItem>
                    ) : (
                      <>
                        <DropdownMenuItem onClick={() => onEdit(tx)}>
                          <Pencil className="mr-2 h-4 w-4" aria-hidden="true" />Editar
                        </DropdownMenuItem>
                        <ConfirmDialog
                          trigger={
                            <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-destructive">
                              <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />Eliminar
                            </DropdownMenuItem>
                          }
                          title="¿Eliminar movimiento?"
                          description="Esta acción no se puede deshacer."
                          onConfirm={() => onDelete(tx.id)}
                        />
                      </>
                    )}
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
