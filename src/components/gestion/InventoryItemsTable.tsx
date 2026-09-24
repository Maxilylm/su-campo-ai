"use client";

import { MoreHorizontal, Package, Pencil, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getStockStatus, type StockStatus } from "@/lib/inventory-stock";
import { cn } from "@/lib/utils";
import { Money, Quantity } from "./Figures";
import { SegmentedControl } from "./SegmentedControl";
import { INVENTORY_CATEGORIES, inventoryCategoryIcon, type InventoryItem } from "./inventory-types";

const STOCK_TEXT: Record<StockStatus, string | undefined> = { bajo: "text-bad", justo: "text-warn", ok: undefined };
const FILTER_OPTIONS = [{ value: "todos", label: "Todos" }, ...INVENTORY_CATEGORIES];
const HEAD = "h-9 text-xs font-medium text-muted-foreground";

function StockBadge({ status }: { status: StockStatus }) {
  if (status === "bajo") return <Badge variant="bad">Bajo</Badge>;
  if (status === "justo") return <Badge variant="warn">Justo</Badge>;
  return <span className="text-xs text-muted-foreground">OK</span>;
}

export function InventoryItemsTable({
  items, filteredCount, filterCat, onFilterChange, currentPage, totalPages, onPageChange,
  focusedItemId, onAddItem, onEditItem, onDeleteItem,
}: {
  /** The current page of already-filtered items. */
  items: InventoryItem[];
  filteredCount: number;
  filterCat: string;
  onFilterChange: (category: string) => void;
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  focusedItemId: string | null;
  onAddItem: () => void;
  onEditItem: (item: InventoryItem) => void;
  onDeleteItem: (id: string) => void;
}) {
  return (
    <section aria-labelledby="inventory-items-title" className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="inventory-items-title" className="text-base font-semibold">Insumos</h2>
        <span className="text-xs text-muted-foreground"><span className="figure">{filteredCount}</span> {filteredCount === 1 ? "insumo" : "insumos"}</span>
      </div>

      <SegmentedControl label="Filtrar por categoría" options={FILTER_OPTIONS} value={filterCat} onChange={onFilterChange} />

      {filteredCount === 0 ? (
        <EmptyState
          icon={Package}
          title={filterCat === "todos" ? "Todavía no hay insumos" : "No hay insumos en esta categoría"}
          description={filterCat === "todos" ? "Cargá tu primer insumo para controlar stock, compras y usos." : "Elegí otra categoría o cargá un insumo nuevo."}
          actionLabel="Cargar insumo"
          onAction={onAddItem}
        />
      ) : (
        <>
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className={cn(HEAD, "pl-4")}>Insumo</TableHead>
                  <TableHead className={cn(HEAD, "text-right")}>Stock</TableHead>
                  <TableHead className={cn(HEAD, "hidden text-right sm:table-cell")}>Mínimo</TableHead>
                  <TableHead className={cn(HEAD, "hidden text-right md:table-cell")}>Costo por unidad</TableHead>
                  <TableHead className={HEAD}>Estado</TableHead>
                  <TableHead className="w-10 pr-2"><span className="sr-only">Acciones</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => {
                  const status = getStockStatus(item);
                  const Icon = inventoryCategoryIcon(item.category);
                  return (
                    <TableRow id={`inventory-item-${item.id}`} key={item.id} className={focusedItemId === item.id ? "bg-accent" : undefined}>
                      <TableCell className="py-3 pl-4">
                        <span className="flex min-w-0 items-center gap-2.5">
                          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                          <span className="min-w-0">
                            <span className="block max-w-[14rem] truncate font-medium sm:max-w-xs">{item.name}</span>
                            {item.notes && <span className="block max-w-[14rem] truncate text-xs text-muted-foreground sm:max-w-xs">{item.notes}</span>}
                          </span>
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-[15px] font-semibold">
                        <Quantity value={item.current_stock} unit={item.unit} className={STOCK_TEXT[status]} />
                      </TableCell>
                      <TableCell className="hidden text-right text-muted-foreground sm:table-cell">
                        {item.min_stock != null ? <Quantity value={item.min_stock} unit={item.unit} /> : "—"}
                      </TableCell>
                      <TableCell className="hidden text-right md:table-cell">
                        {item.cost_per_unit != null ? <Money amount={item.cost_per_unit} currency={item.currency || "USD"} /> : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell><StockBadge status={status} /></TableCell>
                      <TableCell className="pr-2">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon-sm" aria-label={`Acciones para ${item.name}`}><MoreHorizontal className="h-4 w-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => onEditItem(item)}>
                              <Pencil className="mr-2 h-4 w-4" aria-hidden="true" />Editar
                            </DropdownMenuItem>
                            <ConfirmDialog
                              trigger={
                                <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-destructive">
                                  <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />Eliminar
                                </DropdownMenuItem>
                              }
                              title="¿Eliminar insumo?"
                              description={`Se eliminará "${item.name}" del inventario. Esta acción no se puede deshacer.`}
                              onConfirm={() => onDeleteItem(item.id)}
                            />
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Página {currentPage} de {totalPages}</span>
              <div className="flex gap-1">
                <Button variant="outline" size="sm" disabled={currentPage === 1} onClick={() => onPageChange(currentPage - 1)}>Anterior</Button>
                <Button variant="outline" size="sm" disabled={currentPage === totalPages} onClick={() => onPageChange(currentPage + 1)}>Siguiente</Button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
