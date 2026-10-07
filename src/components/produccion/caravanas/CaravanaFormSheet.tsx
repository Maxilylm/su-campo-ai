"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { FormField } from "@/components/FormField";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { CATTLE_CATEGORIES } from "@/lib/cattle";
import {
  CARAVANA_STATUSES, CARAVANA_STATUS_LABELS, caravanaDisplay, caravanaVisual, categoryLabel, normalizeCaravana,
  type CaravanaStatus,
} from "@/lib/caravanas";
import { createIdempotencyKey, sendJsonResult } from "@/lib/mutate";
import { NONE, type CaravanaItem, type LoteOption, type SectionOption } from "./types";

const optional = <span className="font-normal text-muted-foreground">(opcional)</span>;

interface FormValues {
  tag: string;
  visual: string;
  sex: string;
  category: string;
  breed: string;
  birthDate: string;
  loteId: string;
  sectionId: string;
  status: CaravanaStatus;
  notes: string;
}

const EMPTY: FormValues = {
  tag: "", visual: "", sex: NONE, category: NONE, breed: "", birthDate: "", loteId: NONE, sectionId: NONE, status: "activo", notes: "",
};

function formFrom(item: CaravanaItem): FormValues {
  return {
    tag: item.tag_number,
    visual: item.visual_tag || "",
    sex: item.sex || NONE,
    category: item.category || NONE,
    breed: item.breed || "",
    birthDate: item.birth_date || "",
    loteId: item.cattle_id || NONE,
    sectionId: item.cattle_id ? NONE : item.section_id || NONE,
    status: item.status,
    notes: item.notes || "",
  };
}

interface FormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: CaravanaItem | null;
  lotes: LoteOption[];
  sections: SectionOption[];
  readOnly: boolean;
}

/** Add one caravana or edit one (its number is fixed once registered). */
export function CaravanaFormSheet(props: FormSheetProps) {
  // Mounted per opening (and per edited caravana), so the form starts fresh.
  return props.open ? <CaravanaForm key={props.editing?.id ?? "new"} {...props} /> : null;
}

function CaravanaForm({ open, onOpenChange, editing, lotes, sections, readOnly }: FormSheetProps) {
  const [form, setForm] = useState<FormValues>(() => (editing ? formFrom(editing) : EMPTY));
  const [saving, setSaving] = useState(false);
  const attempt = useRef<{ key: string; signature: string } | null>(null);
  const patch = (values: Partial<FormValues>) => setForm((current) => ({ ...current, ...values }));

  const parsedTag = editing ? null : form.tag.trim() ? normalizeCaravana(form.tag) : null;
  const tagHint = parsedTag
    ? parsedTag.ok
      ? `Se guarda como ${caravanaDisplay(parsedTag.tag)} (${caravanaVisual(parsedTag.tag)})${parsedTag.foreign ? " · no es uruguaya" : ""}`
      : parsedTag.reason
    : "15 dígitos que empiezan con 858, o el número UY de la caravana visual.";

  async function save() {
    if (readOnly || saving) return;
    if (!editing && !(parsedTag && parsedTag.ok)) {
      toast.error("Revisá el número de caravana.");
      return;
    }
    setSaving(true);
    const location = {
      cattleId: form.loteId === NONE ? null : form.loteId,
      sectionId: form.loteId === NONE && form.sectionId !== NONE ? form.sectionId : null,
    };
    const fields = {
      visualTag: form.visual.trim() || null,
      sex: form.sex === NONE ? null : form.sex,
      category: form.category === NONE ? null : form.category,
      breed: form.breed.trim() || null,
      birthDate: form.birthDate || null,
      notes: form.notes.trim() || null,
    };
    try {
      let result;
      if (editing) {
        result = await sendJsonResult("/api/caravanas", "PATCH", { ids: [editing.id], ...location, status: form.status, ...fields });
      } else {
        const payload = { tagNumber: form.tag, status: form.status, ...location, ...fields };
        const signature = JSON.stringify(payload);
        if (!attempt.current || attempt.current.signature !== signature) attempt.current = { key: createIdempotencyKey(), signature };
        result = await sendJsonResult("/api/caravanas", "POST", payload, { idempotencyKey: attempt.current.key });
      }
      if (result.ok) {
        toast.success(editing ? "Caravana actualizada" : "Caravana registrada");
        attempt.current = null;
        onOpenChange(false);
      } else {
        toast.error(result.error || "No se pudo guardar la caravana.");
      }
    } catch {
      toast.error("No se pudo guardar la caravana. Revisá tu conexión.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={(next) => { if (!saving) onOpenChange(next); }}>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{editing ? `Caravana ${caravanaDisplay(editing.tag_number)}` : "Nueva caravana"}</SheetTitle>
          <SheetDescription>{editing ? "Corregí los datos del animal o su ubicación." : "Registrá un animal por su caravana oficial. Asignarlo a un lote o potrero es opcional."}</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 px-4 py-2">
          {!editing && (
            <div className="space-y-2">
              <FormField label="Número de caravana">
                <Input value={form.tag} onChange={(event) => patch({ tag: event.target.value })} placeholder="858000012345678 o UY 012345678" inputMode="text" autoComplete="off" aria-describedby="caravana-tag-hint" aria-invalid={parsedTag ? !parsedTag.ok : undefined} />
              </FormField>
              <p id="caravana-tag-hint" className={parsedTag && !parsedTag.ok ? "text-xs text-bad" : "text-xs text-muted-foreground"}>{tagHint}</p>
            </div>
          )}
          <FormField label={<>Caravana visual {optional}</>}>
            <Input value={form.visual} onChange={(event) => patch({ visual: event.target.value })} placeholder="UY 012345678" maxLength={40} />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="caravana-sex">Sexo</Label>
              <Select value={form.sex} onValueChange={(sex) => patch({ sex })}>
                <SelectTrigger id="caravana-sex" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Sin dato</SelectItem>
                  <SelectItem value="macho">Macho</SelectItem>
                  <SelectItem value="hembra">Hembra</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="caravana-category">Categoría</Label>
              <Select value={form.category} onValueChange={(category) => patch({ category })}>
                <SelectTrigger id="caravana-category" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Sin categoría</SelectItem>
                  {CATTLE_CATEGORIES.map((category) => <SelectItem key={category} value={category}>{categoryLabel(category)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label={<>Raza {optional}</>}>
              <Input value={form.breed} onChange={(event) => patch({ breed: event.target.value })} placeholder="Hereford" maxLength={100} />
            </FormField>
            <FormField label={<>Nacimiento {optional}</>}>
              <Input type="date" value={form.birthDate} onChange={(event) => patch({ birthDate: event.target.value })} />
            </FormField>
          </div>
          <div className="space-y-2">
            <Label htmlFor="caravana-lote">Lote {optional}</Label>
            <Select value={form.loteId} onValueChange={(loteId) => patch({ loteId, sectionId: loteId === NONE ? form.sectionId : NONE })}>
              <SelectTrigger id="caravana-lote" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Sin lote</SelectItem>
                {lotes.map((lote) => <SelectItem key={lote.id} value={lote.id}>{lote.label} · {lote.count} cab.</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="caravana-section">Potrero {optional}</Label>
            <Select value={form.loteId === NONE ? form.sectionId : NONE} onValueChange={(sectionId) => patch({ sectionId })} disabled={form.loteId !== NONE}>
              <SelectTrigger id="caravana-section" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{form.loteId === NONE ? "Sin potrero" : "El del lote"}</SelectItem>
                {sections.map((section) => <SelectItem key={section.id} value={section.id}>{section.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {form.loteId !== NONE && <p className="text-xs text-muted-foreground">Con lote, el animal está en el potrero del lote.</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="caravana-status">Estado</Label>
            <Select value={form.status} onValueChange={(status) => patch({ status: status as CaravanaStatus })}>
              <SelectTrigger id="caravana-status" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CARAVANA_STATUSES.map((status) => <SelectItem key={status} value={status}>{CARAVANA_STATUS_LABELS[status]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <FormField label={<>Notas {optional}</>}>
            <Textarea value={form.notes} onChange={(event) => patch({ notes: event.target.value })} maxLength={2000} rows={3} />
          </FormField>
        </div>
        <SheetFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button onClick={() => void save()} disabled={readOnly || saving || (!editing && !(parsedTag && parsedTag.ok))}>{saving ? "Guardando…" : "Guardar"}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
