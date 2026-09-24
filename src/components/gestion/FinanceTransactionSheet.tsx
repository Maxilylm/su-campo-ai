"use client";

import { FormField } from "@/components/FormField";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  FINANCE_CATEGORIES, FINANCE_CURRENCIES,
  type FinanceCattleBatch, type FinanceCrop, type FinanceFormState,
} from "./finance-types";

const OPTIONAL = <span className="font-normal text-muted-foreground">(opcional)</span>;

export function FinanceTransactionSheet({
  open, onOpen, onRequestClose, form, onChange, onSectionChange, onCropChange, onCattleChange,
  onSave, saveDisabled, saving, sections, crops, cattle,
}: {
  open: boolean;
  onOpen: () => void;
  onRequestClose: () => void;
  form: FinanceFormState;
  onChange: (patch: Partial<FinanceFormState>) => void;
  onSectionChange: (value: string) => void;
  onCropChange: (value: string) => void;
  onCattleChange: (value: string) => void;
  onSave: () => void;
  saveDisabled: boolean;
  saving: boolean;
  sections: { id: string; name: string }[];
  crops: FinanceCrop[];
  cattle: FinanceCattleBatch[];
}) {
  const editing = Boolean(form.editingId);
  return (
    <Sheet open={open} onOpenChange={(next) => { if (next) onOpen(); else onRequestClose(); }}>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{editing ? "Editar movimiento" : "Nuevo movimiento"}</SheetTitle>
          <SheetDescription>{editing ? "Corregí el movimiento sin perder su registro histórico." : "Registrá un ingreso o un egreso."}</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 px-4 py-2">
          <div className="space-y-2">
            <Label id="finanzas-tx-type-label">Tipo</Label>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-labelledby="finanzas-tx-type-label">
              {(["ingreso", "egreso"] as const).map((type) => (
                <label
                  key={type}
                  className="flex h-9 cursor-pointer items-center gap-2 rounded-md border border-input bg-card px-3 text-sm transition-colors has-[:checked]:border-primary has-[:checked]:bg-primary-soft has-[:checked]:font-medium has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50"
                >
                  <input
                    type="radio"
                    name="txType"
                    checked={form.type === type}
                    onChange={() => onChange({ type })}
                    className="accent-primary"
                  />
                  {type === "ingreso" ? "Ingreso" : "Egreso"}
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="finanzas-tx-category">Categoría</Label>
            <Select value={form.category} onValueChange={(category) => onChange({ category })}>
              <SelectTrigger id="finanzas-tx-category" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {FINANCE_CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <FormField label={<>Descripción {OPTIONAL}</>}><Input value={form.description} onChange={(e) => onChange({ description: e.target.value })} placeholder="Ej: Venta de novillos" /></FormField>

          <div className="grid grid-cols-[1fr_7rem] gap-3">
            <FormField label="Monto"><Input type="text" inputMode="decimal" value={form.amount} onChange={(e) => onChange({ amount: e.target.value })} placeholder="1.000" className="figure text-base" /></FormField>
            <div className="space-y-2">
              <Label htmlFor="finanzas-tx-currency">Moneda</Label>
              <Select value={form.currency} onValueChange={(currency) => onChange({ currency })}>
                <SelectTrigger id="finanzas-tx-currency" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FINANCE_CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <FormField label="Fecha"><Input type="date" value={form.date} onChange={(e) => onChange({ date: e.target.value })} /></FormField>

          <div className="space-y-2">
            <Label htmlFor="finanzas-tx-section">Sección {OPTIONAL}</Label>
            <Select value={form.sectionId || "none"} onValueChange={onSectionChange}>
              <SelectTrigger id="finanzas-tx-section" className="w-full"><SelectValue placeholder="Sin asignar" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sin asignar</SelectItem>
                {sections.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="finanzas-tx-crop">Cultivo {OPTIONAL}</Label>
            <Select value={form.cropId || "none"} onValueChange={onCropChange}>
              <SelectTrigger id="finanzas-tx-crop" className="w-full"><SelectValue placeholder="Sin asignar" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sin asignar</SelectItem>
                {crops.map((c) => <SelectItem key={c.id} value={c.id}>{c.crop_type}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="finanzas-tx-cattle">Hacienda {OPTIONAL}</Label>
            <Select value={form.cattleId || "none"} onValueChange={onCattleChange}>
              <SelectTrigger id="finanzas-tx-cattle" className="w-full"><SelectValue placeholder="Sin asignar" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sin asignar</SelectItem>
                {cattle.map((c) => <SelectItem key={c.id} value={c.id}>{c.category}{c.breed ? ` (${c.breed})` : ""}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <FormField label={<>Notas {OPTIONAL}</>}><Input value={form.notes} onChange={(e) => onChange({ notes: e.target.value })} placeholder="Observaciones…" /></FormField>
        </div>
        <SheetFooter>
          <Button onClick={onSave} disabled={saveDisabled}>{saving ? "Guardando…" : editing ? "Guardar cambios" : "Guardar movimiento"}</Button>
          <Button variant="outline" onClick={onRequestClose} disabled={saving}>Cancelar</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
