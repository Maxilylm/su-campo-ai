"use client";

import { useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { parseCSV } from "@/lib/csv";
import { sendJsonResult } from "@/lib/mutate";
import { dateInputValue } from "@/lib/date";
import { validateFinanceImportRows, type FinanceImportRow } from "@/lib/finance-import";

interface RelationOption { id: string; name?: string; crop_type?: string; category?: string; breed?: string | null }
const MAX_FILE_BYTES = 1_000_000;
const MAX_ROWS = 200;

function normalizeKey(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
}

function findColumn(headers: string[], aliases: string[]): number {
  const normalized = headers.map(normalizeKey);
  return normalized.findIndex((header) => aliases.includes(header));
}

function valueAt(row: string[], index: number): string {
  return index >= 0 ? (row[index] || "").trim() : "";
}

function numberValue(value: string): number {
  return value ? Number(value.replace(",", ".")) : Number.NaN;
}

function resolveRelation(value: string, options: RelationOption[], nameKey: "name" | "crop_type" | "category"): string | null {
  if (!value) return null;
  const byId = options.find((option) => option.id === value);
  if (byId) return byId.id;
  const normalized = normalizeKey(value);
  const matches = options.filter((option) => normalizeKey(option[nameKey] || "") === normalized);
  return matches.length === 1 ? matches[0].id : value;
}

export function FinanceImportDialog({
  sections, crops, cattle, readOnly, onImported,
}: {
  sections: RelationOption[];
  crops: RelationOption[];
  cattle: RelationOption[];
  readOnly: boolean;
  onImported: () => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<FinanceImportRow[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [reading, setReading] = useState(false);
  const [importing, setImporting] = useState(false);

  function reset() {
    setFileName(""); setRows([]); setErrors([]);
    if (inputRef.current) inputRef.current.value = "";
  }

  function close(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen && !importing) reset();
  }

  async function readFile(file: File) {
    setFileName(file.name); setRows([]); setErrors([]);
    if (file.size > MAX_FILE_BYTES) { setErrors(["El archivo supera el límite de 1 MB."]); return; }
    setReading(true);
    try {
      const parsed = parseCSV(await file.text());
      if (parsed.headers.length === 0 || parsed.rows.length === 0) { setErrors(["El CSV no tiene encabezados y filas de datos."]); return; }
      const aliases = {
        type: ["type", "tipo", "movementtype", "tipomovimiento"],
        category: ["category", "categoria", "rubro"],
        amount: ["amount", "importe", "monto", "valor"],
        currency: ["currency", "moneda"],
        date: ["date", "fecha"],
        description: ["description", "descripcion", "concepto"],
        section: ["section", "seccion", "sectionid", "seccionid"],
        crop: ["crop", "cultivo", "cropid", "cultivoid"],
        cattle: ["cattle", "hacienda", "lote", "cattleid", "haciendaid", "loteid"],
        notes: ["notes", "notas", "observaciones"],
      };
      const columns = Object.fromEntries(Object.entries(aliases).map(([key, values]) => [key, findColumn(parsed.headers, values)])) as Record<keyof typeof aliases, number>;
      const columnErrors: string[] = [];
      if (columns.type < 0) columnErrors.push("Falta la columna tipo (ingreso o egreso).");
      if (columns.category < 0) columnErrors.push("Falta la columna categoría.");
      if (columns.amount < 0) columnErrors.push("Falta la columna importe.");
      if (parsed.rows.length > MAX_ROWS) columnErrors.push(`El archivo tiene ${parsed.rows.length} filas; el máximo es ${MAX_ROWS}.`);
      const rawRows = parsed.rows.slice(0, MAX_ROWS).map((row) => ({
        type: valueAt(row, columns.type),
        category: valueAt(row, columns.category),
        amount: numberValue(valueAt(row, columns.amount)),
        currency: valueAt(row, columns.currency) || "USD",
        date: valueAt(row, columns.date) || dateInputValue(),
        description: valueAt(row, columns.description) || null,
        sectionId: resolveRelation(valueAt(row, columns.section), sections, "name"),
        cropId: resolveRelation(valueAt(row, columns.crop), crops, "crop_type"),
        cattleId: resolveRelation(valueAt(row, columns.cattle), cattle, "category"),
        notes: valueAt(row, columns.notes) || null,
      }));
      const validation = validateFinanceImportRows(rawRows, MAX_ROWS);
      setRows(validation.rows);
      setErrors([...columnErrors, ...validation.errors]);
    } catch {
      setErrors(["No se pudo leer el archivo CSV."]);
    } finally { setReading(false); }
  }

  async function importRows() {
    if (readOnly || rows.length === 0 || errors.length > 0) return;
    setImporting(true);
    const result = await sendJsonResult("/api/financial/import", "POST", { rows });
    if (!result.ok) { toast.error(result.error || "No se pudo importar Finanzas."); setImporting(false); return; }
    toast.success(`${rows.length} movimientos financieros importados`);
    try { await onImported(); } catch { toast.error("Los movimientos se importaron, pero no se pudo actualizar la vista."); }
    finally { setImporting(false); close(false); }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <Button variant="outline" onClick={() => setOpen(true)} disabled={readOnly}><Upload className="mr-1.5 h-4 w-4" />Importar CSV</Button>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Importar Finanzas desde CSV</DialogTitle><DialogDescription>Cargá ingresos y egresos históricos. La importación valida todas las filas antes de guardarlas.</DialogDescription></DialogHeader>
        <div className="grid gap-4">
          <div className="rounded-lg border border-dashed border-border p-4 text-sm">
            <input ref={inputRef} type="file" accept=".csv,text/csv" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void readFile(file); }} />
            <Button variant="outline" onClick={() => inputRef.current?.click()} disabled={reading || importing}><Upload className="mr-1.5 h-4 w-4" />{reading ? "Leyendo…" : "Elegir archivo CSV"}</Button>
            {fileName && <span className="ml-3 text-muted-foreground">{fileName}</span>}
            <p className="mt-2 text-xs text-muted-foreground">Máximo 200 filas y 1 MB. Requeridas: tipo, categoría e importe. Moneda por defecto: USD; fecha por defecto: hoy.</p>
            <a href="/plantilla-finanzas.csv" download className="mt-2 inline-block text-xs font-medium text-primary hover:underline">Descargar plantilla CSV</a>
          </div>
          {errors.length > 0 && <div role="alert" className="rounded-lg border border-red-500/25 bg-red-500/5 p-3 text-sm"><div className="flex items-center gap-2 font-medium text-red-700 dark:text-red-300"><AlertTriangle className="h-4 w-4" /> Corregí el archivo antes de importar</div><ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">{errors.slice(0, 8).map((error, index) => <li key={`${error}-${index}`}>{error}</li>)}</ul>{errors.length > 8 && <p className="mt-1 text-xs text-muted-foreground">Hay {errors.length - 8} errores más.</p>}</div>}
          {rows.length > 0 && <div className="rounded-lg border border-border p-3"><div className="flex items-center gap-2 text-sm font-medium"><CheckCircle2 className="h-4 w-4 text-emerald-500" />{rows.length} filas listas para revisar</div><div className="mt-2 max-h-40 overflow-auto text-xs text-muted-foreground">{rows.slice(0, 5).map((row, index) => <p key={`${row.description || row.category}-${index}`} className="border-t border-border py-1.5">{row.type} · {row.category} · {row.amount} {row.currency} · {row.date}</p>)}{rows.length > 5 && <p className="pt-1.5">…y {rows.length - 5} filas más</p>}</div></div>}
        </div>
        <DialogFooter><DialogClose asChild><Button variant="outline" disabled={importing}>Cancelar</Button></DialogClose><Button onClick={() => void importRows()} disabled={importing || reading || rows.length === 0 || errors.length > 0}>{importing ? "Importando…" : "Importar movimientos"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
