"use client";

import { MoreHorizontal, Pencil, Search, Tag, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  CARAVANA_STATUSES, CARAVANA_STATUS_LABELS, caravanaDisplay, caravanaLoteLabel, caravanaVisual, categoryLabel, sexLabel,
  type CaravanaStatus,
} from "@/lib/caravanas";
import { SectionTitle } from "../SectionTitle";
import { ALL, NONE, effectiveSectionName, type CaravanaFilters, type CaravanaItem, type LoteOption, type SectionOption } from "./types";

const HEAD = "h-9 text-xs font-medium text-muted-foreground";
const STATUS_VARIANT: Record<CaravanaStatus, "ok" | "muted" | "bad" | "warn"> = {
  activo: "ok", vendido: "muted", muerto: "bad", faltante: "warn",
};

function birthLabel(value: string | null): string {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "—";
}

export function CaravanasTable({
  items, total, totalRegistered, filters, onFiltersChange, page, totalPages, onPageChange, loading,
  lotes, sections, selected, onToggle, onTogglePage, readOnly, onImportHint, onEdit, onDelete,
}: {
  items: CaravanaItem[];
  total: number;
  totalRegistered: number;
  filters: CaravanaFilters;
  onFiltersChange: (patch: Partial<CaravanaFilters>) => void;
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  loading: boolean;
  lotes: LoteOption[];
  sections: SectionOption[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onTogglePage: (select: boolean) => void;
  readOnly: boolean;
  onImportHint: () => void;
  onEdit: (item: CaravanaItem) => void;
  onDelete: (ids: string[]) => Promise<void>;
}) {
  const filtered = Boolean(filters.q.trim() || filters.cattleId || filters.sectionId || filters.status !== "activo");
  const pageSelected = items.length > 0 && items.every((item) => selected.has(item.id));

  return (
    <section aria-labelledby="caravanas-list-title">
      <SectionTitle
        id="caravanas-list-title"
        title="Caravanas"
        meta={<>{total.toLocaleString("es-UY")} {total === 1 ? "animal" : "animales"}{filtered ? " con estos filtros" : ""}</>}
      />
      <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative sm:col-span-2 lg:col-span-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            type="search"
            aria-label="Buscar caravana"
            value={filters.q}
            onChange={(event) => onFiltersChange({ q: event.target.value })}
            placeholder="Número, UY…, raza o nota"
            className="pl-9"
          />
        </div>
        <Select value={filters.status} onValueChange={(status) => onFiltersChange({ status: status as CaravanaFilters["status"] })}>
          <SelectTrigger aria-label="Filtrar por estado" className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            {CARAVANA_STATUSES.map((status) => <SelectItem key={status} value={status}>{CARAVANA_STATUS_LABELS[status]}s</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filters.cattleId === "none" ? NONE : filters.cattleId || ALL} onValueChange={(value) => onFiltersChange({ cattleId: value === ALL ? "" : value === NONE ? "none" : value })}>
          <SelectTrigger aria-label="Filtrar por lote" className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos los lotes</SelectItem>
            <SelectItem value={NONE}>Sin lote</SelectItem>
            {lotes.map((lote) => <SelectItem key={lote.id} value={lote.id}>{lote.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filters.sectionId === "none" ? NONE : filters.sectionId || ALL} onValueChange={(value) => onFiltersChange({ sectionId: value === ALL ? "" : value === NONE ? "none" : value })}>
          <SelectTrigger aria-label="Filtrar por potrero" className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos los potreros</SelectItem>
            <SelectItem value={NONE}>Sin lote ni potrero</SelectItem>
            {sections.map((section) => <SelectItem key={section.id} value={section.id}>{section.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {totalRegistered === 0 ? (
        <EmptyState
          icon={Tag}
          title="Todavía no hay caravanas"
          description="Importá el listado de animales que descargás del SNIG (Excel o CSV) o registrá una caravana a mano."
          actionLabel={readOnly ? undefined : "Importar del SNIG"}
          onAction={readOnly ? undefined : onImportHint}
        />
      ) : items.length === 0 && !loading ? (
        <EmptyState
          icon={Search}
          title="Sin coincidencias"
          description="Probá con otro número, estado, lote o potrero."
          actionLabel="Limpiar filtros"
          onAction={() => onFiltersChange({ q: "", status: "activo", cattleId: "", sectionId: "" })}
        />
      ) : (
        <>
          <div className={loading ? "overflow-hidden rounded-lg border border-border bg-card opacity-60 transition-opacity" : "overflow-hidden rounded-lg border border-border bg-card"} aria-busy={loading}>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-12 pl-2">
                    <label className="flex h-11 w-11 cursor-pointer items-center justify-center">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-primary"
                        checked={pageSelected}
                        onChange={(event) => onTogglePage(event.target.checked)}
                        disabled={readOnly}
                        aria-label="Seleccionar todas las caravanas de esta página"
                      />
                    </label>
                  </TableHead>
                  <TableHead className={HEAD}>Caravana</TableHead>
                  <TableHead className={HEAD}>Sexo</TableHead>
                  <TableHead className={HEAD}>Categoría</TableHead>
                  <TableHead className={HEAD}>Raza</TableHead>
                  <TableHead className={HEAD}>Nacimiento</TableHead>
                  <TableHead className={HEAD}>Lote / potrero</TableHead>
                  <TableHead className={HEAD}>Estado</TableHead>
                  <TableHead className="w-12"><span className="sr-only">Acciones</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => {
                  const lote = item.cattle_id ? caravanaLoteLabel(item.cattle) : null;
                  const section = effectiveSectionName(item);
                  const display = caravanaDisplay(item.tag_number);
                  return (
                    <TableRow key={item.id} data-state={selected.has(item.id) ? "selected" : undefined}>
                      <TableCell className="pl-2">
                        <label className="flex h-11 w-11 cursor-pointer items-center justify-center">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-primary"
                            checked={selected.has(item.id)}
                            onChange={() => onToggle(item.id)}
                            disabled={readOnly}
                            aria-label={`Seleccionar caravana ${display}`}
                          />
                        </label>
                      </TableCell>
                      <TableCell>
                        <span className="block font-mono text-sm">{display}</span>
                        <span className="block text-xs text-muted-foreground">{item.visual_tag || caravanaVisual(item.tag_number)}</span>
                      </TableCell>
                      <TableCell>{item.sex ? sexLabel(item.sex) : <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell>{item.category ? categoryLabel(item.category) : <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="text-muted-foreground">{item.breed || "—"}</TableCell>
                      <TableCell className="figure text-muted-foreground">{birthLabel(item.birth_date)}</TableCell>
                      <TableCell>
                        {lote
                          ? <span>{lote}</span>
                          : section
                            ? <span>{section} <span className="text-xs text-muted-foreground">(sin lote)</span></span>
                            : <span className="text-muted-foreground">Sin asignar</span>}
                      </TableCell>
                      <TableCell><Badge variant={STATUS_VARIANT[item.status] || "muted"}>{CARAVANA_STATUS_LABELS[item.status] || item.status}</Badge></TableCell>
                      <TableCell className="pr-2">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon-sm" aria-label={`Acciones de la caravana ${display}`}><MoreHorizontal className="h-4 w-4" aria-hidden="true" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => onEdit(item)} disabled={readOnly}><Pencil className="mr-2 h-4 w-4" aria-hidden="true" />Editar</DropdownMenuItem>
                            <ConfirmDialog
                              trigger={<DropdownMenuItem onSelect={(event) => event.preventDefault()} className="text-destructive" disabled={readOnly}><Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />Eliminar</DropdownMenuItem>}
                              title="Eliminar caravana"
                              description="Se borra del registro de CampoAI (no del SNIG). Si el animal se vendió o murió, mejor cambiá su estado."
                              onConfirm={() => onDelete([item.id])}
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
            <nav aria-label="Páginas de caravanas" className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
              <span>Página <span className="figure text-foreground">{page}</span> de <span className="figure text-foreground">{totalPages}</span></span>
              <div className="flex gap-1.5">
                <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => onPageChange(page - 1)}>Anterior</Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages || loading} onClick={() => onPageChange(page + 1)}>Siguiente</Button>
              </div>
            </nav>
          )}
        </>
      )}
    </section>
  );
}
