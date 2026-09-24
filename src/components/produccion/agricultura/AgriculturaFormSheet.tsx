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
import type { AgricultureSheetMode, ApplicationFormValues, CropFormValues } from "@/lib/agricultura-form";
import {
  APP_TYPES, CROP_TYPES, IRRIGATION_TYPES, SOIL_TYPES, STATUS_LABELS, WEATHER_OPTIONS, optionLabel,
} from "./types";

function OptionSelect({ id, value, onChange, options, placeholder }: {
  id: string; value: string; onChange: (value: string) => void; options: string[]; placeholder?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} className="w-full"><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        {options.map((option) => <SelectItem key={option} value={option}>{optionLabel(option)}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

export function AgriculturaFormSheet({
  open, onOpenChange, mode, sections, crop, onCropChange, application, onApplicationChange,
  saving, readOnly, onCancel, onSaveCrop, onSaveApplication,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: AgricultureSheetMode;
  sections: { id: string; name: string }[];
  crop: CropFormValues;
  onCropChange: (patch: Partial<CropFormValues>) => void;
  application: ApplicationFormValues;
  onApplicationChange: (patch: Partial<ApplicationFormValues>) => void;
  saving: boolean;
  readOnly: boolean;
  onCancel: () => void;
  onSaveCrop: () => void;
  onSaveApplication: () => void;
}) {
  const isEditing = mode === "edit-crop";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto">
        {mode !== "add-app" ? (
          <>
            <SheetHeader>
              <SheetTitle>{isEditing ? "Editar cultivo" : "Nuevo cultivo"}</SheetTitle>
              <SheetDescription>{isEditing ? "Corregí los datos del cultivo." : "Cargá un cultivo nuevo en tu campo."}</SheetDescription>
            </SheetHeader>
            <div className="space-y-4 px-4 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="agri-crop-type">Cultivo</Label>
                  <OptionSelect id="agri-crop-type" value={crop.type} onChange={(type) => onCropChange({ type })} options={CROP_TYPES} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="agri-crop-variety">Variedad</Label>
                  <Input id="agri-crop-variety" value={crop.variety} onChange={(e) => onCropChange({ variety: e.target.value })} placeholder="Ej.: DM 46i17" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="agri-crop-section">Sección</Label>
                  <Select value={crop.section} onValueChange={(section) => onCropChange({ section })}>
                    <SelectTrigger id="agri-crop-section" className="w-full"><SelectValue placeholder="Elegí una sección" /></SelectTrigger>
                    <SelectContent>
                      {sections.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="agri-crop-hectares">Hectáreas</Label>
                  <Input id="agri-crop-hectares" type="text" inputMode="decimal" value={crop.hectares} onChange={(e) => onCropChange({ hectares: e.target.value })} placeholder="100" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="agri-crop-planting-date">Fecha de siembra</Label>
                  <Input id="agri-crop-planting-date" type="date" value={crop.plantingDate} onChange={(e) => onCropChange({ plantingDate: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="agri-crop-status">Estado</Label>
                  <Select value={crop.status} onValueChange={(status) => onCropChange({ status })}>
                    <SelectTrigger id="agri-crop-status" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(STATUS_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="agri-crop-expected-harvest">Cosecha esperada</Label>
                  <Input id="agri-crop-expected-harvest" type="date" value={crop.expectedHarvest} onChange={(e) => onCropChange({ expectedHarvest: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="agri-crop-actual-harvest">Cosecha real</Label>
                  <Input id="agri-crop-actual-harvest" type="date" value={crop.actualHarvest} onChange={(e) => onCropChange({ actualHarvest: e.target.value })} />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="agri-crop-yield">Rendimiento total (kg)</Label>
                <Input id="agri-crop-yield" type="text" inputMode="decimal" value={crop.yieldKg} onChange={(e) => onCropChange({ yieldKg: e.target.value })} placeholder="3500" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="agri-crop-soil-type">Tipo de suelo</Label>
                  <OptionSelect id="agri-crop-soil-type" value={crop.soilType} onChange={(soilType) => onCropChange({ soilType })} options={SOIL_TYPES} placeholder="Elegí" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="agri-crop-irrigation">Riego</Label>
                  <OptionSelect id="agri-crop-irrigation" value={crop.irrigationType} onChange={(irrigationType) => onCropChange({ irrigationType })} options={IRRIGATION_TYPES} placeholder="Elegí" />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="agri-crop-notes">Notas</Label>
                <Input id="agri-crop-notes" value={crop.notes} onChange={(e) => onCropChange({ notes: e.target.value })} placeholder="Observaciones…" />
              </div>
            </div>
            <SheetFooter>
              <Button onClick={onSaveCrop} disabled={readOnly || saving}>
                {saving ? "Guardando…" : isEditing ? "Guardar cambios" : "Crear cultivo"}
              </Button>
              <Button variant="outline" onClick={onCancel} disabled={saving}>Cancelar</Button>
            </SheetFooter>
          </>
        ) : (
          <>
            <SheetHeader>
              <SheetTitle>Nueva aplicación</SheetTitle>
              <SheetDescription>Registrá una aplicación de producto en el cultivo.</SheetDescription>
            </SheetHeader>
            <div className="space-y-4 px-4 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="agri-app-type">Tipo</Label>
                  <OptionSelect id="agri-app-type" value={application.type} onChange={(type) => onApplicationChange({ type })} options={APP_TYPES} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="agri-app-date">Fecha</Label>
                  <Input id="agri-app-date" type="date" value={application.date} onChange={(e) => onApplicationChange({ date: e.target.value })} />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="agri-app-product">Producto</Label>
                <Input id="agri-app-product" value={application.product} onChange={(e) => onApplicationChange({ product: e.target.value })} placeholder="Ej.: Glifosato" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="agri-app-dose">Dosis por hectárea</Label>
                  <Input id="agri-app-dose" value={application.dose} onChange={(e) => onApplicationChange({ dose: e.target.value })} placeholder="2 L/ha" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="agri-app-total">Total aplicado</Label>
                  <Input id="agri-app-total" value={application.total} onChange={(e) => onApplicationChange({ total: e.target.value })} placeholder="200 L" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="agri-app-applied-by">Aplicado por</Label>
                  <Input id="agri-app-applied-by" value={application.appliedBy} onChange={(e) => onApplicationChange({ appliedBy: e.target.value })} placeholder="Nombre" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="agri-app-weather">Clima</Label>
                  <OptionSelect id="agri-app-weather" value={application.weather} onChange={(weather) => onApplicationChange({ weather })} options={WEATHER_OPTIONS} placeholder="Elegí" />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="agri-app-notes">Notas</Label>
                <Input id="agri-app-notes" value={application.notes} onChange={(e) => onApplicationChange({ notes: e.target.value })} placeholder="Observaciones…" />
              </div>
            </div>
            <SheetFooter>
              <Button onClick={onSaveApplication} disabled={readOnly || saving}>
                {saving ? "Guardando…" : "Registrar aplicación"}
              </Button>
              <Button variant="outline" onClick={onCancel} disabled={saving}>Cancelar</Button>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
