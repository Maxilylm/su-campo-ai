"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CATTLE_CATEGORIES } from "@/lib/cattle";
import type { CattleDraft, DraftValidation, SectionOption } from "@/lib/cattle-import";
import { INVENTORY_CATEGORIES, INVENTORY_CURRENCIES, INVENTORY_UNITS, type InventoryDraft } from "@/lib/inventory-import";
import { cn } from "@/lib/utils";

// Editable preview of the rows an import will write. Native inputs and
// selects (not Radix) keep 200 rows × 9 cells light on a phone.

const cellInput = "h-9 w-full min-w-0 rounded-md border border-input bg-card px-2 text-sm text-foreground outline-none pointer-coarse:min-h-11 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-bad";
const headCell = "sticky top-0 z-[1] bg-muted px-1.5 py-2 text-left text-xs font-medium text-muted-foreground";
const UNKNOWN_SECTION = "__unknown__";
const NO_SECTION = "";

function RowErrors({ problems, colSpan, id }: { problems: string[]; colSpan: number; id: string }) {
  if (problems.length === 0) return null;
  return (
    <tr>
      <td colSpan={colSpan} id={id} className="px-2 pb-2 text-xs text-bad">{problems.join(" ")}</td>
    </tr>
  );
}

function RowNumber({ index, invalid }: { index: number; invalid: boolean }) {
  return <td className={cn("px-1.5 py-1 text-right text-xs tabular-nums", invalid ? "font-semibold text-bad" : "text-muted-foreground")}>{index + 1}</td>;
}

function DeleteRowButton({ index, disabled, onDelete }: { index: number; disabled: boolean; onDelete: (index: number) => void }) {
  return (
    <td className="px-1 py-1">
      <Button variant="ghost" size="icon-sm" disabled={disabled} onClick={() => onDelete(index)} aria-label={`Quitar fila ${index + 1}`} title="Quitar fila">
        <Trash2 aria-hidden="true" />
      </Button>
    </td>
  );
}

export function CattlePreviewTable({
  drafts, validation, sections, disabled, onChange, onDelete, onAdd,
}: {
  drafts: CattleDraft[];
  validation: DraftValidation;
  sections: readonly SectionOption[];
  disabled: boolean;
  onChange: (index: number, patch: Partial<CattleDraft>) => void;
  onDelete: (index: number) => void;
  onAdd: () => void;
}) {
  return (
    <div className="grid gap-2">
      <div className="max-h-[45vh] overflow-auto rounded-lg border border-border">
        <table className="w-full min-w-[56rem] border-collapse text-sm">
          <caption className="sr-only">Filas de hacienda a importar; podés corregir cada celda</caption>
          <thead>
            <tr>
              <th scope="col" className={cn(headCell, "w-8 text-right")}>#</th>
              <th scope="col" className={cn(headCell, "w-32")}>Categoría</th>
              <th scope="col" className={cn(headCell, "w-20")}>Cantidad</th>
              <th scope="col" className={cn(headCell, "w-40")}>Potrero</th>
              <th scope="col" className={cn(headCell, "w-28")}>Raza</th>
              <th scope="col" className={cn(headCell, "w-20")}>Peso kg</th>
              <th scope="col" className={cn(headCell, "w-28")}>Caravana</th>
              <th scope="col" className={cn(headCell, "w-32")}>Nacimiento</th>
              <th scope="col" className={headCell}>Notas</th>
              <th scope="col" className={cn(headCell, "w-10")}><span className="sr-only">Acciones</span></th>
            </tr>
          </thead>
          <tbody>
            {drafts.map((draft, index) => {
              const problems = validation.rowErrors[index] ?? [];
              const invalid = problems.length > 0;
              const errorId = `cattle-import-row-${index}-errors`;
              const describedBy = invalid ? errorId : undefined;
              const label = (field: string) => `${field}, fila ${index + 1}`;
              const sectionValue = draft.sectionId ?? (draft.sectionName.trim() ? UNKNOWN_SECTION : NO_SECTION);
              const categoryKnown = (CATTLE_CATEGORIES as readonly string[]).includes(draft.category);
              return [
                <tr key={`row-${index}`} className={cn("border-t border-border align-top", invalid && "bg-bad-soft/60")}>
                  <RowNumber index={index} invalid={invalid} />
                  <td className="px-1 py-1">
                    <select className={cellInput} value={categoryKnown ? draft.category : ""} disabled={disabled} aria-label={label("Categoría")} aria-invalid={!categoryKnown || undefined} aria-describedby={describedBy} onChange={(event) => onChange(index, { category: event.target.value })}>
                      {!categoryKnown && <option value="">{draft.category ? `«${draft.category}» ?` : "Elegir…"}</option>}
                      {CATTLE_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
                    </select>
                  </td>
                  <td className="px-1 py-1">
                    <input className={cellInput} inputMode="numeric" value={draft.count} disabled={disabled} aria-label={label("Cantidad")} aria-describedby={describedBy} onChange={(event) => onChange(index, { count: event.target.value })} />
                  </td>
                  <td className="px-1 py-1">
                    <select
                      className={cellInput}
                      value={sectionValue}
                      disabled={disabled}
                      aria-label={label("Potrero")}
                      aria-invalid={sectionValue === UNKNOWN_SECTION || undefined}
                      aria-describedby={describedBy}
                      onChange={(event) => {
                        const value = event.target.value;
                        if (value === UNKNOWN_SECTION) return;
                        const section = sections.find((option) => option.id === value);
                        onChange(index, { sectionId: section?.id ?? null, sectionName: section?.name ?? "" });
                      }}
                    >
                      {sectionValue === UNKNOWN_SECTION && <option value={UNKNOWN_SECTION}>«{draft.sectionName.trim()}» no existe</option>}
                      <option value={NO_SECTION}>Sin potrero</option>
                      {sections.map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}
                    </select>
                  </td>
                  <td className="px-1 py-1"><input className={cellInput} value={draft.breed} maxLength={100} disabled={disabled} aria-label={label("Raza")} onChange={(event) => onChange(index, { breed: event.target.value })} /></td>
                  <td className="px-1 py-1"><input className={cellInput} inputMode="decimal" value={draft.weightKg} disabled={disabled} aria-label={label("Peso en kg")} aria-describedby={describedBy} onChange={(event) => onChange(index, { weightKg: event.target.value })} /></td>
                  <td className="px-1 py-1"><input className={cellInput} value={draft.earTag} maxLength={100} disabled={disabled} aria-label={label("Caravana")} aria-describedby={describedBy} onChange={(event) => onChange(index, { earTag: event.target.value })} /></td>
                  <td className="px-1 py-1"><input className={cellInput} placeholder="AAAA-MM-DD" value={draft.birthDate} maxLength={20} disabled={disabled} aria-label={label("Fecha de nacimiento")} aria-describedby={describedBy} onChange={(event) => onChange(index, { birthDate: event.target.value })} /></td>
                  <td className="px-1 py-1"><input className={cellInput} value={draft.notes} maxLength={2000} disabled={disabled} aria-label={label("Notas")} onChange={(event) => onChange(index, { notes: event.target.value })} /></td>
                  <DeleteRowButton index={index} disabled={disabled} onDelete={onDelete} />
                </tr>,
                <RowErrors key={`errors-${index}`} problems={problems} colSpan={10} id={errorId} />,
              ];
            })}
          </tbody>
        </table>
      </div>
      <div>
        <Button variant="outline" size="sm" onClick={onAdd} disabled={disabled}><Plus aria-hidden="true" />Agregar fila</Button>
      </div>
    </div>
  );
}

export function InventoryPreviewTable({
  drafts, validation, disabled, onChange, onDelete, onAdd,
}: {
  drafts: InventoryDraft[];
  validation: DraftValidation;
  disabled: boolean;
  onChange: (index: number, patch: Partial<InventoryDraft>) => void;
  onDelete: (index: number) => void;
  onAdd: () => void;
}) {
  return (
    <div className="grid gap-2">
      <div className="max-h-[45vh] overflow-auto rounded-lg border border-border">
        <table className="w-full min-w-[52rem] border-collapse text-sm">
          <caption className="sr-only">Insumos a importar; podés corregir cada celda</caption>
          <thead>
            <tr>
              <th scope="col" className={cn(headCell, "w-8 text-right")}>#</th>
              <th scope="col" className={cn(headCell, "w-44")}>Nombre</th>
              <th scope="col" className={cn(headCell, "w-36")}>Categoría</th>
              <th scope="col" className={cn(headCell, "w-24")}>Unidad</th>
              <th scope="col" className={cn(headCell, "w-20")}>Stock</th>
              <th scope="col" className={cn(headCell, "w-20")}>Mínimo</th>
              <th scope="col" className={cn(headCell, "w-24")}>Costo unit.</th>
              <th scope="col" className={cn(headCell, "w-20")}>Moneda</th>
              <th scope="col" className={headCell}>Notas</th>
              <th scope="col" className={cn(headCell, "w-10")}><span className="sr-only">Acciones</span></th>
            </tr>
          </thead>
          <tbody>
            {drafts.map((draft, index) => {
              const problems = validation.rowErrors[index] ?? [];
              const invalid = problems.length > 0;
              const errorId = `inventory-import-row-${index}-errors`;
              const describedBy = invalid ? errorId : undefined;
              const label = (field: string) => `${field}, fila ${index + 1}`;
              const categoryKnown = (INVENTORY_CATEGORIES as readonly string[]).includes(draft.category);
              const unitKnown = (INVENTORY_UNITS as readonly string[]).includes(draft.unit);
              const currencyKnown = (INVENTORY_CURRENCIES as readonly string[]).includes(draft.currency);
              return [
                <tr key={`row-${index}`} className={cn("border-t border-border align-top", invalid && "bg-bad-soft/60")}>
                  <RowNumber index={index} invalid={invalid} />
                  <td className="px-1 py-1"><input className={cellInput} value={draft.name} maxLength={200} disabled={disabled} aria-label={label("Nombre")} aria-invalid={!draft.name.trim() || undefined} aria-describedby={describedBy} onChange={(event) => onChange(index, { name: event.target.value })} /></td>
                  <td className="px-1 py-1">
                    <select className={cellInput} value={categoryKnown ? draft.category : ""} disabled={disabled} aria-label={label("Categoría")} aria-invalid={!categoryKnown || undefined} aria-describedby={describedBy} onChange={(event) => onChange(index, { category: event.target.value })}>
                      {!categoryKnown && <option value="">{draft.category ? `«${draft.category}» ?` : "Elegir…"}</option>}
                      {INVENTORY_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
                    </select>
                  </td>
                  <td className="px-1 py-1">
                    <select className={cellInput} value={unitKnown ? draft.unit : ""} disabled={disabled} aria-label={label("Unidad")} aria-invalid={!unitKnown || undefined} aria-describedby={describedBy} onChange={(event) => onChange(index, { unit: event.target.value })}>
                      {!unitKnown && <option value="">{draft.unit ? `«${draft.unit}» ?` : "Elegir…"}</option>}
                      {INVENTORY_UNITS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                    </select>
                  </td>
                  <td className="px-1 py-1"><input className={cellInput} inputMode="decimal" value={draft.currentStock} disabled={disabled} aria-label={label("Stock actual")} aria-describedby={describedBy} onChange={(event) => onChange(index, { currentStock: event.target.value })} /></td>
                  <td className="px-1 py-1"><input className={cellInput} inputMode="decimal" value={draft.minStock} disabled={disabled} aria-label={label("Stock mínimo")} aria-describedby={describedBy} onChange={(event) => onChange(index, { minStock: event.target.value })} /></td>
                  <td className="px-1 py-1"><input className={cellInput} inputMode="decimal" value={draft.costPerUnit} disabled={disabled} aria-label={label("Costo unitario")} aria-describedby={describedBy} onChange={(event) => onChange(index, { costPerUnit: event.target.value })} /></td>
                  <td className="px-1 py-1">
                    <select className={cellInput} value={currencyKnown ? draft.currency : ""} disabled={disabled} aria-label={label("Moneda")} aria-invalid={!currencyKnown || undefined} aria-describedby={describedBy} onChange={(event) => onChange(index, { currency: event.target.value })}>
                      {!currencyKnown && <option value="">{draft.currency ? `«${draft.currency}» ?` : "Elegir…"}</option>}
                      {INVENTORY_CURRENCIES.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
                    </select>
                  </td>
                  <td className="px-1 py-1"><input className={cellInput} value={draft.notes} maxLength={2000} disabled={disabled} aria-label={label("Notas")} onChange={(event) => onChange(index, { notes: event.target.value })} /></td>
                  <DeleteRowButton index={index} disabled={disabled} onDelete={onDelete} />
                </tr>,
                <RowErrors key={`errors-${index}`} problems={problems} colSpan={10} id={errorId} />,
              ];
            })}
          </tbody>
        </table>
      </div>
      <div>
        <Button variant="outline" size="sm" onClick={onAdd} disabled={disabled}><Plus aria-hidden="true" />Agregar fila</Button>
      </div>
    </div>
  );
}
