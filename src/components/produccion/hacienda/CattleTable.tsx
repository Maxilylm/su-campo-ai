"use client";

import { Beef, DollarSign, MoreHorizontal, Pencil, Scale, Search, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { SectionTitle } from "../SectionTitle";
import { VaccinationBadge } from "./VaccinationBadge";
import type { CattleRow } from "./types";

const HEAD = "h-9 text-xs font-medium text-muted-foreground";

export function CattleTable({
  rows, totalCount, filteredCount, query, onQueryChange, onClearQuery, currentPage, totalPages, onPageChange,
  focusedCattleId, onAdd, onEdit, onWeigh, onCost, onDelete,
}: {
  rows: CattleRow[];
  totalCount: number;
  filteredCount: number;
  query: string;
  onQueryChange: (value: string) => void;
  onClearQuery: () => void;
  currentPage: number;
  totalPages: number;
  onPageChange: (update: (page: number) => number) => void;
  focusedCattleId: string | null;
  onAdd: () => void;
  onEdit: (cattle: CattleRow) => void;
  onWeigh: (cattle: CattleRow) => void;
  onCost: (cattle: CattleRow) => void;
  onDelete: (id: string) => Promise<void>;
}) {
  return (
    <section aria-labelledby="hacienda-cattle-title">
      <SectionTitle
        id="hacienda-cattle-title"
        title="Lotes de hacienda"
        meta={<>{query.trim() ? `${filteredCount} de ${totalCount}` : totalCount} {totalCount === 1 && !query.trim() ? "lote" : "lotes"}</>}
        actions={
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              type="search"
              aria-label="Buscar hacienda"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Buscar sección, raza o caravana…"
              className="pl-9"
            />
          </div>
        }
      />
      {totalCount === 0 ? (
        <EmptyState icon={Beef} title="Todavía no hay hacienda" description="Registrá tu primer lote para seguir cabezas, pesos y vacunas." actionLabel="Registrar hacienda" onAction={onAdd} />
      ) : filteredCount === 0 ? (
        <EmptyState icon={Search} title="Sin coincidencias" description="Probá con otra sección, categoría, raza, caravana o estado sanitario." actionLabel="Limpiar búsqueda" onAction={onClearQuery} />
      ) : (
        <>
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className={`${HEAD} pl-4`}>Potrero</TableHead>
                  <TableHead className={HEAD}>Categoría</TableHead>
                  <TableHead className={HEAD}>Raza</TableHead>
                  <TableHead className={`${HEAD} text-right`}>Cabezas</TableHead>
                  <TableHead className={`${HEAD} text-right`}>Peso prom.</TableHead>
                  <TableHead className={HEAD}>Caravana</TableHead>
                  <TableHead className={HEAD}>Vacunas</TableHead>
                  <TableHead className="w-12"><span className="sr-only">Acciones</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((c) => (
                  <TableRow id={`hacienda-cattle-${c.id}`} key={c.id} className={focusedCattleId === c.id ? "bg-accent ring-1 ring-inset ring-primary/40" : undefined}>
                    <TableCell className="pl-4">
                      <span className="flex items-center gap-2">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: c.sectionColor }} aria-hidden="true" />
                        <span className={c.section_id ? undefined : "text-muted-foreground"}>{c.sectionName}</span>
                      </span>
                    </TableCell>
                    <TableCell className="capitalize">{c.category}</TableCell>
                    <TableCell className="text-muted-foreground">{c.breed || "—"}</TableCell>
                    <TableCell className="figure text-right text-base font-semibold">{c.count.toLocaleString("es-UY")}</TableCell>
                    <TableCell className="text-right">
                      {c.weight_kg
                        ? <><span className="figure text-base">{c.weight_kg}</span><span className="ml-1 text-xs text-muted-foreground">kg</span></>
                        : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{c.ear_tag || c.tag_range || "—"}</TableCell>
                    <TableCell><VaccinationBadge status={c.vaccination_status} /></TableCell>
                    <TableCell className="pr-2">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label={`Acciones de ${c.category}${c.breed ? ` ${c.breed}` : ""} en ${c.sectionName}`}><MoreHorizontal className="h-4 w-4" aria-hidden="true" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => onEdit(c)}><Pencil className="mr-2 h-4 w-4" aria-hidden="true" />Editar</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => onWeigh(c)}><Scale className="mr-2 h-4 w-4" aria-hidden="true" />Registrar pesaje</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => onCost(c)}><DollarSign className="mr-2 h-4 w-4" aria-hidden="true" />Registrar gasto del lote</DropdownMenuItem>
                          <ConfirmDialog trigger={<DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-destructive"><Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />Eliminar</DropdownMenuItem>} title="Eliminar hacienda" description="Esta acción no se puede deshacer." onConfirm={() => onDelete(c.id)} />
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {totalPages > 1 && (
            <nav aria-label="Páginas de hacienda" className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
              <span>Página <span className="figure text-foreground">{currentPage}</span> de <span className="figure text-foreground">{totalPages}</span></span>
              <div className="flex gap-1.5">
                <Button variant="outline" size="sm" disabled={currentPage === 1} onClick={() => onPageChange((p) => p - 1)}>Anterior</Button>
                <Button variant="outline" size="sm" disabled={currentPage === totalPages} onClick={() => onPageChange((p) => p + 1)}>Siguiente</Button>
              </div>
            </nav>
          )}
        </>
      )}
    </section>
  );
}
