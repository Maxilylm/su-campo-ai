"use client";

import { ChevronRight, MapPin, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { pastureTone, waterTone } from "@/lib/hacienda-form";
import { cn } from "@/lib/utils";
import { SectionTitle } from "../SectionTitle";
import { VaccinationBadge } from "./VaccinationBadge";
import type { Cattle, SectionWithCattle } from "./types";

const TONE_TEXT = { bad: "text-bad", warn: "text-warn" } as const;

export function SectionList({
  sections, expandedSections, focusedSectionId, onToggle, onAdd, onEdit, onDelete, onEditCattle,
}: {
  sections: SectionWithCattle[];
  expandedSections: Set<string>;
  focusedSectionId: string | null;
  onToggle: (id: string) => void;
  onAdd: () => void;
  onEdit: (section: SectionWithCattle) => void;
  onDelete: (id: string) => Promise<void>;
  onEditCattle: (cattle: Cattle) => void;
}) {
  return (
    <section aria-labelledby="hacienda-sections-title">
      <SectionTitle id="hacienda-sections-title" title="Potreros" meta={sections.length > 0 ? `${sections.length} en el campo` : undefined} />
      {sections.length === 0 ? (
        <EmptyState icon={MapPin} title="Todavía no hay secciones" description="Cargá tu primera sección o potrero para ubicar la hacienda." actionLabel="Agregar sección" onAction={onAdd} />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
          {sections.map((s) => {
            const expanded = expandedSections.has(s.id);
            const headCount = s.cattle.reduce((sum, c) => sum + c.count, 0);
            const water = waterTone(s.water_status);
            const pasture = pastureTone(s.pasture_status);
            const focused = focusedSectionId === s.id;
            return (
              <li id={`hacienda-section-${s.id}`} key={s.id} className={cn(focused && "bg-accent ring-2 ring-inset ring-primary/40")}>
                <div className="flex items-center gap-1 pr-2">
                  <button
                    type="button"
                    onClick={() => onToggle(s.id)}
                    aria-expanded={expanded}
                    className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left outline-none transition-colors hover:bg-accent/60 focus-visible:bg-accent"
                  >
                    <ChevronRight className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-90")} aria-hidden="true" />
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: s.color }} aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{s.name}</span>
                      <span className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                        {s.size_hectares ? <span><span className="figure text-foreground">{s.size_hectares}</span> ha</span> : null}
                        <span className={water ? TONE_TEXT[water] : undefined}>Agua {s.water_status}</span>
                        <span className={pasture ? TONE_TEXT[pasture] : undefined}>Pasto {s.pasture_status}</span>
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="figure text-lg font-semibold">{headCount.toLocaleString("es-UY")}</span>
                      <span className="ml-1 text-xs text-muted-foreground">cab.</span>
                    </span>
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label={`Acciones de ${s.name}`} className="shrink-0"><MoreHorizontal className="h-4 w-4" aria-hidden="true" /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onEdit(s)}><Pencil className="mr-2 h-4 w-4" aria-hidden="true" />Editar</DropdownMenuItem>
                      <ConfirmDialog trigger={<DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-destructive"><Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />Eliminar</DropdownMenuItem>} title="Eliminar sección" description={`Esto eliminará la sección "${s.name}" y toda la hacienda asociada. Esta acción no se puede deshacer.`} onConfirm={() => onDelete(s.id)} />
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                {expanded && s.cattle.length > 0 && (
                  <div className="border-t border-border bg-muted/40 py-1 pl-[3.25rem] pr-2">
                    <p className="py-1.5 text-xs text-muted-foreground">
                      {s.cattle.length === 1 ? "1 lote en esta sección" : `${s.cattle.length} lotes en esta sección`}
                    </p>
                    <ul className="divide-y divide-border">
                      {s.cattle.map((c) => (
                        <li key={c.id} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                          <span className="min-w-0 truncate">
                            <span className="figure font-semibold">{c.count}</span>{" "}
                            <span className="capitalize">{c.category}</span>
                            {c.breed && <span className="text-muted-foreground"> · {c.breed}</span>}
                          </span>
                          <span className="flex shrink-0 items-center gap-1.5">
                            <VaccinationBadge status={c.vaccination_status} />
                            <Button variant="ghost" size="icon-sm" aria-label={`Editar ${c.category}${c.breed ? ` ${c.breed}` : ""}`} onClick={() => onEditCattle(c)}><Pencil className="h-3.5 w-3.5" aria-hidden="true" /></Button>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {expanded && s.cattle.length === 0 && (
                  <p className="border-t border-border bg-muted/40 py-2.5 pl-[3.25rem] pr-4 text-xs text-muted-foreground">Sin hacienda en esta sección.</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
