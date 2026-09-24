"use client";

import { FormField } from "@/components/FormField";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { InventorySheetMode } from "@/lib/inventory-stock";
import {
  INVENTORY_CATEGORIES, INVENTORY_CURRENCIES, INVENTORY_UNITS, MOVEMENT_LABELS,
  type InventoryCattleOption, type InventoryCropOption, type InventoryItem, type ItemFormState, type MovementFormState,
} from "./inventory-types";

const OPTIONAL = <span className="font-normal text-muted-foreground">(opcional)</span>;

const MOVEMENT_DESCRIPTIONS: Record<"uso" | "ajuste" | "pérdida", string> = {
  uso: "Descuenta stock del inventario.",
  ajuste: "Corregí el stock. Usá un valor positivo para sumar o negativo para descontar.",
  "pérdida": "Registrá una merma o pérdida; el stock se descuenta automáticamente.",
};

export function InventorySheet({
  open, onOpen, onRequestClose, mode, readOnly, saving,
  item, onItemChange, onSaveItem,
  movement, onMovementChange, onSaveMovement,
  onSelectItem, onSelectSection, onSelectCrop, onSelectCattle,
  items, sections, crops, cattle,
}: {
  open: boolean;
  onOpen: () => void;
  onRequestClose: () => void;
  mode: InventorySheetMode;
  readOnly: boolean;
  saving: boolean;
  item: ItemFormState;
  onItemChange: (patch: Partial<ItemFormState>) => void;
  onSaveItem: () => void;
  movement: MovementFormState;
  onMovementChange: (patch: Partial<MovementFormState>) => void;
  onSaveMovement: () => void;
  /** Purchase item picker: also adopts the item's currency. */
  onSelectItem: (id: string) => void;
  onSelectSection: (value: string) => void;
  onSelectCrop: (id: string) => void;
  onSelectCattle: (value: string) => void;
  items: InventoryItem[];
  sections: { id: string; name: string }[];
  /** Crops and cattle already narrowed to the chosen section. */
  crops: InventoryCropOption[];
  cattle: InventoryCattleOption[];
}) {
  const itemMode = mode === "add-item" || mode === "edit-item";
  const movementDisabled = readOnly || !movement.itemId || !movement.quantity || saving;
  const cancel = <Button variant="outline" onClick={onRequestClose} disabled={saving}>Cancelar</Button>;

  return (
    <Sheet open={open} onOpenChange={(next) => { if (next) { onOpen(); return; } onRequestClose(); }}>
      <SheetContent className="overflow-y-auto">
        {itemMode && (
          <>
            <SheetHeader>
              <SheetTitle>{mode === "edit-item" ? "Editar insumo" : "Nuevo insumo"}</SheetTitle>
              <SheetDescription>{mode === "edit-item" ? "Actualizá los datos del insumo sin perder sus movimientos." : "Agregá un insumo al inventario."}</SheetDescription>
            </SheetHeader>
            <div className="space-y-4 px-4 py-2">
              <FormField label="Nombre"><Input value={item.name} onChange={(e) => onItemChange({ name: e.target.value })} placeholder="Ej: Glifosato" /></FormField>
              <div className="space-y-2">
                <Label htmlFor="inventario-item-category">Categoría</Label>
                <Select value={item.category} onValueChange={(category) => onItemChange({ category })}>
                  <SelectTrigger id="inventario-item-category" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {INVENTORY_CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="inventario-item-unit">Unidad</Label>
                  <Select value={item.unit} onValueChange={(unit) => onItemChange({ unit })}>
                    <SelectTrigger id="inventario-item-unit" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {INVENTORY_UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="inventario-item-currency">Moneda</Label>
                  <Select value={item.currency} onValueChange={(currency) => onItemChange({ currency })}>
                    <SelectTrigger id="inventario-item-currency" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {INVENTORY_CURRENCIES.map((currency) => <SelectItem key={currency} value={currency}>{currency}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <FormField label={<>Stock mínimo {OPTIONAL}</>}><Input type="text" inputMode="decimal" value={item.minStock} onChange={(e) => onItemChange({ minStock: e.target.value })} placeholder="10" /></FormField>
              <FormField label={<>Notas {OPTIONAL}</>}><Input value={item.notes} onChange={(e) => onItemChange({ notes: e.target.value })} placeholder="Proveedor, presentación…" /></FormField>
            </div>
            <SheetFooter>
              <Button onClick={onSaveItem} disabled={readOnly || !item.name.trim() || saving}>{saving ? "Guardando…" : mode === "edit-item" ? "Guardar cambios" : "Crear insumo"}</Button>
              {cancel}
            </SheetFooter>
          </>
        )}

        {mode === "compra" && (
          <>
            <SheetHeader>
              <SheetTitle>Registrar compra</SheetTitle>
              <SheetDescription>Ingresá stock al inventario.</SheetDescription>
            </SheetHeader>
            <div className="space-y-4 px-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="inventario-mov-item">Insumo</Label>
                <Select value={movement.itemId} onValueChange={onSelectItem}>
                  <SelectTrigger id="inventario-mov-item" className="w-full"><SelectValue placeholder="Elegí un insumo" /></SelectTrigger>
                  <SelectContent>
                    {items.map((i) => <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <FormField label="Cantidad"><Input type="text" inputMode="decimal" value={movement.quantity} onChange={(e) => onMovementChange({ quantity: e.target.value })} placeholder="100" /></FormField>
              <div className="grid grid-cols-[1fr_7rem] gap-3">
                <FormField label={`Costo por unidad (${movement.currency})`}><Input type="text" inputMode="decimal" value={movement.unitCost} onChange={(e) => onMovementChange({ unitCost: e.target.value })} placeholder="5,50" /></FormField>
                <div className="space-y-2">
                  <Label htmlFor="inventario-mov-currency">Moneda</Label>
                  <Select value={movement.currency} onValueChange={(currency) => onMovementChange({ currency })}>
                    <SelectTrigger id="inventario-mov-currency" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {INVENTORY_CURRENCIES.map((currency) => <SelectItem key={currency} value={currency}>{currency}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <FormField label="Fecha"><Input type="date" value={movement.date} onChange={(e) => onMovementChange({ date: e.target.value })} /></FormField>
              <FormField label={<>Notas {OPTIONAL}</>}><Input value={movement.notes} onChange={(e) => onMovementChange({ notes: e.target.value })} placeholder="Proveedor, factura…" /></FormField>
            </div>
            <SheetFooter>
              <Button onClick={onSaveMovement} disabled={movementDisabled}>{saving ? "Guardando…" : "Registrar compra"}</Button>
              {cancel}
            </SheetFooter>
          </>
        )}

        {(mode === "uso" || mode === "ajuste" || mode === "pérdida") && (
          <>
            <SheetHeader>
              <SheetTitle>{mode === "uso" ? "Registrar uso" : mode === "ajuste" ? "Ajustar stock" : "Registrar pérdida"}</SheetTitle>
              <SheetDescription>{MOVEMENT_DESCRIPTIONS[mode]}</SheetDescription>
            </SheetHeader>
            <div className="space-y-4 px-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="inventario-mov-item">Insumo</Label>
                <Select value={movement.itemId} onValueChange={(itemId) => onMovementChange({ itemId })}>
                  <SelectTrigger id="inventario-mov-item" className="w-full"><SelectValue placeholder="Elegí un insumo" /></SelectTrigger>
                  <SelectContent>
                    {items.map((i) => <SelectItem key={i.id} value={i.id}>{i.name} ({i.current_stock} {i.unit})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="inventario-mov-quantity">{mode === "ajuste" ? "Cambio de stock (+/−)" : "Cantidad"}</Label>
                <Input id="inventario-mov-quantity" type="text" inputMode="decimal" value={movement.quantity} onChange={(e) => onMovementChange({ quantity: e.target.value })} placeholder={mode === "ajuste" ? "Ej: -3 o 10" : "10"} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="inventario-mov-section">Sección {OPTIONAL}</Label>
                <Select value={movement.sectionId || "none"} onValueChange={onSelectSection}>
                  <SelectTrigger id="inventario-mov-section" className="w-full"><SelectValue placeholder="Sin sección" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sin sección</SelectItem>
                    {sections.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="inventario-mov-crop">Cultivo {OPTIONAL}</Label>
                <Select value={movement.cropId || "none"} onValueChange={(value) => onSelectCrop(value === "none" ? "" : value)}>
                  <SelectTrigger id="inventario-mov-crop" className="w-full"><SelectValue placeholder="Sin cultivo" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sin cultivo</SelectItem>
                    {crops.map((crop) => <SelectItem key={crop.id} value={crop.id}>{crop.crop_type}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="inventario-mov-cattle">Hacienda {OPTIONAL}</Label>
                <Select value={movement.cattleId || "none"} onValueChange={onSelectCattle}>
                  <SelectTrigger id="inventario-mov-cattle" className="w-full"><SelectValue placeholder="Sin hacienda" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sin hacienda</SelectItem>
                    {cattle.map((row) => (
                      <SelectItem key={row.id} value={row.id}>{row.category}{row.breed ? ` · ${row.breed}` : ""} · {row.count} cab.</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <FormField label="Fecha"><Input type="date" value={movement.date} onChange={(e) => onMovementChange({ date: e.target.value })} /></FormField>
              <FormField label={<>Notas {OPTIONAL}</>}><Input value={movement.notes} onChange={(e) => onMovementChange({ notes: e.target.value })} placeholder="Observaciones…" /></FormField>
            </div>
            <SheetFooter>
              <Button onClick={onSaveMovement} disabled={movementDisabled}>{saving ? "Guardando…" : `Registrar ${MOVEMENT_LABELS[mode].toLocaleLowerCase()}`}</Button>
              {cancel}
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
