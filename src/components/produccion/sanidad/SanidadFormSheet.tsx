"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import type { HealthFormValues, SanidadSheetMode, VaccinationFormValues } from "@/lib/sanidad-form";
import { HEALTH_TYPES, VACCINES, lotLabel, type CattleOption } from "./types";

const optional = <span className="font-normal text-muted-foreground">(opcional)</span>;

export function SanidadFormSheet({
  open, onOpenChange, mode, sections, lots, editingVaccination, editingHealth,
  vaccination, onVaccinationChange, onVaccinationSection, onVaccinationLot,
  health, onHealthChange, onHealthSection, onHealthLot,
  saving, readOnly, onCancel, onSaveVaccination, onSaveHealth,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: SanidadSheetMode;
  sections: { id: string; name: string }[];
  lots: CattleOption[];
  editingVaccination: boolean;
  editingHealth: boolean;
  vaccination: VaccinationFormValues;
  onVaccinationChange: (patch: Partial<VaccinationFormValues>) => void;
  onVaccinationSection: (value: string) => void;
  onVaccinationLot: (value: string) => void;
  health: HealthFormValues;
  onHealthChange: (patch: Partial<HealthFormValues>) => void;
  onHealthSection: (value: string) => void;
  onHealthLot: (value: string) => void;
  saving: boolean;
  readOnly: boolean;
  onCancel: () => void;
  onSaveVaccination: () => void;
  onSaveHealth: () => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto">
        {mode === "add-vax" && (
          <>
            <SheetHeader>
              <SheetTitle>{editingVaccination ? "Editar vacunación" : "Registrar vacunación"}</SheetTitle>
              <SheetDescription>{editingVaccination ? "Corregí el registro sin perder el historial sanitario." : "Registrá una vacunación aplicada a la hacienda."}</SheetDescription>
            </SheetHeader>
            <div className="space-y-4 px-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="sanidad-vax-name">Vacuna</Label>
                <Select value={vaccination.name} onValueChange={(name) => onVaccinationChange({ name })}>
                  <SelectTrigger id="sanidad-vax-name" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {vaccination.name && !VACCINES.includes(vaccination.name) && <SelectItem value={vaccination.name}>{vaccination.name}</SelectItem>}
                    {VACCINES.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="sanidad-vax-section">Sección</Label>
                <Select value={vaccination.section || "none"} onValueChange={onVaccinationSection}>
                  <SelectTrigger id="sanidad-vax-section" className="w-full"><SelectValue placeholder="Toda la hacienda" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Toda la hacienda</SelectItem>
                    {sections.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="sanidad-vax-cattle">Lote {optional}</Label>
                <Select value={vaccination.cattle || "none"} onValueChange={onVaccinationLot}>
                  <SelectTrigger id="sanidad-vax-cattle" className="w-full"><SelectValue placeholder="Toda la hacienda" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sin lote específico</SelectItem>
                    {lots.map((cattle) => <SelectItem key={cattle.id} value={cattle.id}>{lotLabel(cattle)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="sanidad-vax-count">Cabezas vacunadas</Label>
                <Input id="sanidad-vax-count" type="text" inputMode="numeric" value={vaccination.count} onChange={(e) => onVaccinationChange({ count: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="sanidad-vax-date">Fecha de aplicación</Label>
                  <Input id="sanidad-vax-date" type="date" value={vaccination.date} onChange={(e) => onVaccinationChange({ date: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sanidad-vax-next-due">Próxima dosis</Label>
                  <Input id="sanidad-vax-next-due" type="date" value={vaccination.nextDue} onChange={(e) => onVaccinationChange({ nextDue: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="sanidad-vax-by">Aplicada por</Label>
                  <Input id="sanidad-vax-by" value={vaccination.appliedBy} onChange={(e) => onVaccinationChange({ appliedBy: e.target.value })} placeholder="Nombre" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sanidad-vax-batch">Lote de la vacuna</Label>
                  <Input id="sanidad-vax-batch" value={vaccination.batch} onChange={(e) => onVaccinationChange({ batch: e.target.value })} placeholder="Número" />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="sanidad-vax-notes">Notas</Label>
                <Input id="sanidad-vax-notes" value={vaccination.notes} onChange={(e) => onVaccinationChange({ notes: e.target.value })} placeholder="Observaciones…" />
              </div>
            </div>
            <SheetFooter>
              <Button onClick={onSaveVaccination} disabled={readOnly || saving}>
                {saving ? "Guardando…" : editingVaccination ? "Guardar cambios" : "Registrar vacunación"}
              </Button>
              <Button variant="outline" onClick={onCancel} disabled={saving}>Cancelar</Button>
            </SheetFooter>
          </>
        )}
        {mode === "add-health" && (
          <>
            <SheetHeader>
              <SheetTitle>{editingHealth ? "Editar evento de salud" : "Registrar evento de salud"}</SheetTitle>
              <SheetDescription>{editingHealth ? "Corregí el evento sin perder el historial sanitario." : "Registrá nacimientos, muertes, enfermedades y otros eventos."}</SheetDescription>
            </SheetHeader>
            <div className="space-y-4 px-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="sanidad-health-type">Tipo</Label>
                <Select value={health.type} onValueChange={(type) => onHealthChange({ type })}>
                  <SelectTrigger id="sanidad-health-type" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {HEALTH_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="sanidad-health-desc">Descripción</Label>
                <Input id="sanidad-health-desc" value={health.description} onChange={(e) => onHealthChange({ description: e.target.value })} placeholder="¿Qué pasó?" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sanidad-health-section">Sección</Label>
                <Select value={health.section || "none"} onValueChange={onHealthSection}>
                  <SelectTrigger id="sanidad-health-section" className="w-full"><SelectValue placeholder="General" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">General</SelectItem>
                    {sections.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="sanidad-health-cattle">Lote {optional}</Label>
                <Select value={health.cattle || "none"} onValueChange={onHealthLot}>
                  <SelectTrigger id="sanidad-health-cattle" className="w-full"><SelectValue placeholder="General / varios lotes" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">General / varios lotes</SelectItem>
                    {lots.map((cattle) => <SelectItem key={cattle.id} value={cattle.id}>{lotLabel(cattle)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="sanidad-health-count">Cabezas afectadas</Label>
                  <Input id="sanidad-health-count" type="text" inputMode="numeric" value={health.count} onChange={(e) => onHealthChange({ count: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sanidad-health-date">Fecha</Label>
                  <Input id="sanidad-health-date" type="date" value={health.date} onChange={(e) => onHealthChange({ date: e.target.value })} />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="sanidad-health-vet">Veterinario</Label>
                <Input id="sanidad-health-vet" value={health.veterinarian} onChange={(e) => onHealthChange({ veterinarian: e.target.value })} placeholder="Nombre" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sanidad-health-notes">Notas</Label>
                <Input id="sanidad-health-notes" value={health.notes} onChange={(e) => onHealthChange({ notes: e.target.value })} placeholder="Observaciones adicionales…" />
              </div>
            </div>
            <SheetFooter>
              <Button onClick={onSaveHealth} disabled={readOnly || !health.description.trim() || saving}>
                {saving ? "Guardando…" : editingHealth ? "Guardar cambios" : "Registrar evento"}
              </Button>
              <Button variant="outline" onClick={onCancel} disabled={saving}>Cancelar</Button>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
