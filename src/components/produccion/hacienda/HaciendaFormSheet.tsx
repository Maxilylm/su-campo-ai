"use client";

import { FormField } from "@/components/FormField";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import type { CattleFormValues, HaciendaSheetMode, SectionFormValues } from "@/lib/hacienda-form";
import { cn } from "@/lib/utils";
import { BREEDS, CATEGORIES, SECTION_COLORS } from "./types";

const optional = <span className="font-normal text-muted-foreground">(opcional)</span>;

export function HaciendaFormSheet({
  open, onOpenChange, mode, sections, section, onSectionChange, cattle, onCattleChange,
  saving, readOnly, onCancel, onSaveSection, onSaveCattle,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: HaciendaSheetMode;
  sections: { id: string; name: string }[];
  section: SectionFormValues;
  onSectionChange: (patch: Partial<SectionFormValues>) => void;
  cattle: CattleFormValues;
  onCattleChange: (patch: Partial<CattleFormValues>) => void;
  saving: boolean;
  readOnly: boolean;
  onCancel: () => void;
  onSaveSection: () => void;
  onSaveCattle: () => void;
}) {
  const isSecForm = mode === "add-section" || mode === "edit-section";
  const isEditing = mode.startsWith("edit");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto">
        {isSecForm ? (
          <>
            <SheetHeader>
              <SheetTitle>{isEditing ? "Editar potrero" : "Nuevo potrero"}</SheetTitle>
              <SheetDescription>Cargá o corregí un potrero de tu campo.</SheetDescription>
            </SheetHeader>
            <div className="space-y-4 px-4 py-2">
              <FormField label="Nombre"><Input value={section.name} onChange={(e) => onSectionChange({ name: e.target.value })} placeholder="Ej.: Norte" /></FormField>
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Hectáreas"><Input type="text" inputMode="decimal" value={section.hectares} onChange={(e) => onSectionChange({ hectares: e.target.value })} placeholder="100" /></FormField>
                <FormField label="Capacidad (cabezas)"><Input type="text" inputMode="numeric" value={section.capacity} onChange={(e) => onSectionChange({ capacity: e.target.value })} placeholder="500" /></FormField>
              </div>
              <div className="space-y-2">
                <Label id="hacienda-sec-color-label">Color en el mapa</Label>
                <div className="flex flex-wrap gap-2" role="group" aria-labelledby="hacienda-sec-color-label">
                  {SECTION_COLORS.map((c) => {
                    const selected = section.color === c.value;
                    return (
                      <button
                        type="button"
                        key={c.value}
                        onClick={() => onSectionChange({ color: c.value })}
                        aria-label={c.label}
                        aria-pressed={selected}
                        className={cn(
                          "h-8 w-8 rounded-full outline-none ring-offset-2 ring-offset-background transition-shadow focus-visible:ring-2 focus-visible:ring-ring",
                          selected && "ring-2 ring-foreground",
                        )}
                        style={{ backgroundColor: c.value }}
                      />
                    );
                  })}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="hacienda-sec-water">Agua</Label>
                  <Select value={section.water} onValueChange={(water) => onSectionChange({ water })}>
                    <SelectTrigger id="hacienda-sec-water" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bueno">Bueno</SelectItem>
                      <SelectItem value="bajo">Bajo</SelectItem>
                      <SelectItem value="seco">Seco</SelectItem>
                      <SelectItem value="inundado">Inundado</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="hacienda-sec-pasture">Pasto</Label>
                  <Select value={section.pasture} onValueChange={(pasture) => onSectionChange({ pasture })}>
                    <SelectTrigger id="hacienda-sec-pasture" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bueno">Bueno</SelectItem>
                      <SelectItem value="sobrepastoreado">Sobrepastoreado</SelectItem>
                      <SelectItem value="seco">Seco</SelectItem>
                      <SelectItem value="creciendo">Creciendo</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <FormField label="Notas"><Input value={section.notes} onChange={(e) => onSectionChange({ notes: e.target.value })} placeholder="Observaciones…" /></FormField>
            </div>
            <SheetFooter>
              <Button onClick={onSaveSection} disabled={readOnly || !section.name.trim() || saving}>{saving ? "Guardando…" : isEditing ? "Guardar cambios" : "Crear potrero"}</Button>
              <Button variant="outline" onClick={onCancel} disabled={saving}>Cancelar</Button>
            </SheetFooter>
          </>
        ) : (
          <>
            <SheetHeader>
              <SheetTitle>{isEditing ? "Editar hacienda" : "Nueva hacienda"}</SheetTitle>
              <SheetDescription>Registrá o corregí un lote de hacienda.</SheetDescription>
            </SheetHeader>
            <div className="space-y-4 px-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="hacienda-cat-section">Potrero {optional}</Label>
                <Select value={cattle.section || "none"} onValueChange={(value) => onCattleChange({ section: value === "none" ? "" : value })}>
                  <SelectTrigger id="hacienda-cat-section" className="w-full"><SelectValue placeholder="Sin potrero" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sin potrero</SelectItem>
                    {sections.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="hacienda-cat-category">Categoría</Label>
                  <Select value={cattle.category} onValueChange={(category) => onCattleChange({ category })}>
                    <SelectTrigger id="hacienda-cat-category" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="hacienda-cat-breed">Raza</Label>
                  <Select value={cattle.breed} onValueChange={(breed) => onCattleChange({ breed })}>
                    <SelectTrigger id="hacienda-cat-breed" className="w-full"><SelectValue placeholder="Elegí la raza" /></SelectTrigger>
                    <SelectContent>{BREEDS.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Cabezas"><Input type="text" inputMode="numeric" value={cattle.count} onChange={(e) => onCattleChange({ count: e.target.value })} placeholder="1" /></FormField>
                <FormField label="Peso promedio (kg)"><Input type="text" inputMode="decimal" value={cattle.weight} onChange={(e) => onCattleChange({ weight: e.target.value })} placeholder="350" /></FormField>
              </div>
              <FormField label="Caravana"><Input value={cattle.earTag} onChange={(e) => onCattleChange({ earTag: e.target.value })} placeholder="001-050" /></FormField>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="hacienda-cat-origin">Origen</Label>
                  <Select value={cattle.origin} onValueChange={(origin) => onCattleChange({ origin })}>
                    <SelectTrigger id="hacienda-cat-origin" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="propio">Propio</SelectItem>
                      <SelectItem value="comprado">Comprado</SelectItem>
                      <SelectItem value="transferido">Transferido</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="hacienda-cat-vax-status">Vacunación</Label>
                  <Select value={cattle.vaccinationStatus} onValueChange={(vaccinationStatus) => onCattleChange({ vaccinationStatus })}>
                    <SelectTrigger id="hacienda-cat-vax-status" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="al_dia">Al día</SelectItem>
                      <SelectItem value="pendiente">Pendiente</SelectItem>
                      <SelectItem value="vencida">Vencida</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="hacienda-cat-repro">Estado reproductivo</Label>
                  <Select value={cattle.reproductive || "none"} onValueChange={(value) => onCattleChange({ reproductive: value === "none" ? "" : value })}>
                    <SelectTrigger id="hacienda-cat-repro" className="w-full"><SelectValue placeholder="No aplica" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No aplica</SelectItem>
                      <SelectItem value="prenada">Preñada</SelectItem>
                      <SelectItem value="lactando">Lactando</SelectItem>
                      <SelectItem value="servicio">En servicio</SelectItem>
                      <SelectItem value="vacia">Vacía</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="hacienda-cat-health">Estado sanitario</Label>
                  <Select value={cattle.health} onValueChange={(health) => onCattleChange({ health })}>
                    <SelectTrigger id="hacienda-cat-health" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="healthy">Sano</SelectItem>
                      <SelectItem value="enfermo">Enfermo</SelectItem>
                      <SelectItem value="tratamiento">En tratamiento</SelectItem>
                      <SelectItem value="cuarentena">Cuarentena</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <FormField label="Notas"><Input value={cattle.notes} onChange={(e) => onCattleChange({ notes: e.target.value })} placeholder="Observaciones…" /></FormField>
            </div>
            <SheetFooter>
              <Button onClick={onSaveCattle} disabled={readOnly || saving}>{saving ? "Guardando…" : isEditing ? "Guardar cambios" : "Registrar"}</Button>
              <Button variant="outline" onClick={onCancel} disabled={saving}>Cancelar</Button>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
