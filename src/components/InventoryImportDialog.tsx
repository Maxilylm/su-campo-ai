"use client";

import { useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { parseCSV } from "@/lib/csv";
import { createIdempotencyKey, sendJsonResult } from "@/lib/mutate";
import { parseLocalizedNumber } from "@/lib/number";

interface ImportRow {
  name: string;
  category: string;
  unit: string;
  currentStock: number;
  minStock: number | null;
  costPerUnit: number | null;
  currency: string;
  notes: string | null;
}

const MAX_FILE_BYTES = 1_000_000;
const MAX_ROWS = 200;
const CATEGORIES = new Set(["alimento", "semilla", "fertilizante", "agroquímico", "medicamento", "combustible", "otro"]);
const UNITS = new Set(["kg", "L", "dosis", "unidad"]);
const CURRENCIES = new Set(["USD", "UYU", "ARS"]);

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

function numberOrNull(value: string): number | null {
  if (!value) return null;
  const number = parseLocalizedNumber(value);
  return Number.isFinite(number) ? number : Number.NaN;
}

export function InventoryImportDialog({
  readOnly,
  onImported,
}: {
  readOnly: boolean;
  onImported: () => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const importBatchKeyRef = useRef<string | null>(null);
  const readRequestIdRef = useRef(0);
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [reading, setReading] = useState(false);
  const [importing, setImporting] = useState(false);

  function reset() {
    readRequestIdRef.current += 1;
    setFileName(""); setRows([]); setErrors([]);
    importBatchKeyRef.current = null;
    if (inputRef.current) inputRef.current.value = "";
  }

  function close(nextOpen: boolean) {
    if (!nextOpen && (reading || importing)) return;
    setOpen(nextOpen);
    if (!nextOpen && !importing) reset();
  }

  async function readFile(file: File) {
    const requestId = ++readRequestIdRef.current;
    setFileName(file.name); setRows([]); setErrors([]);
    importBatchKeyRef.current = null;
    if (file.size > MAX_FILE_BYTES) {
      setErrors(["El archivo supera el límite de 1 MB."]); return;
    }
    importBatchKeyRef.current = createIdempotencyKey();
    setReading(true);
    try {
      const parsed = parseCSV(await file.text());
      if (requestId !== readRequestIdRef.current) return;
      if (parsed.headers.length === 0 || parsed.rows.length === 0) {
        setErrors(["El CSV no tiene encabezados y filas de datos."]); return;
      }
      const aliases = {
        name: ["name", "nombre", "item", "insumo"],
        category: ["category", "categoria", "tipo"],
        unit: ["unit", "unidad"],
        currentStock: ["currentstock", "stockactual", "stock", "cantidad"],
        minStock: ["minstock", "stockminimo", "minimo"],
        costPerUnit: ["costperunit", "costounitario", "costo"],
        currency: ["currency", "moneda"],
        notes: ["notes", "notas", "observaciones"],
      };
      const columns = Object.fromEntries(Object.entries(aliases).map(([key, values]) => [key, findColumn(parsed.headers, values)])) as Record<keyof typeof aliases, number>;
      const nextRows: ImportRow[] = [];
      const nextErrors: string[] = [];
      if (columns.name < 0) nextErrors.push("Falta la columna nombre (name o nombre).");
      if (columns.category < 0) nextErrors.push("Falta la columna categoría (category o categoria).");
      if (columns.unit < 0) nextErrors.push("Falta la columna unidad (unit o unidad).");
      if (parsed.rows.length > MAX_ROWS) nextErrors.push(`El archivo tiene ${parsed.rows.length} filas; el máximo es ${MAX_ROWS}.`);

      parsed.rows.slice(0, MAX_ROWS).forEach((row, index) => {
        const line = index + 2;
        const name = valueAt(row, columns.name);
        const category = valueAt(row, columns.category) || "otro";
        const unit = valueAt(row, columns.unit) || "unidad";
        const currency = valueAt(row, columns.currency) || "USD";
        const currentStock = numberOrNull(valueAt(row, columns.currentStock)) ?? 0;
        const minStock = numberOrNull(valueAt(row, columns.minStock));
        const costPerUnit = numberOrNull(valueAt(row, columns.costPerUnit));
        if (!name) nextErrors.push(`Fila ${line}: falta el nombre.`);
        if (!CATEGORIES.has(category)) nextErrors.push(`Fila ${line}: categoría inválida.`);
        if (!UNITS.has(unit)) nextErrors.push(`Fila ${line}: unidad inválida.`);
        if (!CURRENCIES.has(currency)) nextErrors.push(`Fila ${line}: moneda inválida.`);
        if (!Number.isFinite(currentStock) || currentStock < 0) nextErrors.push(`Fila ${line}: stock actual inválido.`);
        if (minStock !== null && (!Number.isFinite(minStock) || minStock < 0)) nextErrors.push(`Fila ${line}: stock mínimo inválido.`);
        if (costPerUnit !== null && (!Number.isFinite(costPerUnit) || costPerUnit < 0)) nextErrors.push(`Fila ${line}: costo unitario inválido.`);
        nextRows.push({ name, category, unit, currentStock, minStock, costPerUnit, currency, notes: valueAt(row, columns.notes) || null });
      });
      setRows(nextRows); setErrors(nextErrors);
    } catch {
      if (requestId === readRequestIdRef.current) setErrors(["No se pudo leer el archivo CSV."]);
    } finally {
      if (requestId === readRequestIdRef.current) setReading(false);
    }
  }

  async function importRows() {
    if (readOnly || rows.length === 0 || errors.length > 0) return;
    setImporting(true);
    const importBatchKey = importBatchKeyRef.current || createIdempotencyKey();
    importBatchKeyRef.current = importBatchKey;
    const result = await sendJsonResult("/api/inventory/import", "POST", { rows }, { idempotencyKey: importBatchKey, timeoutMs: 30000 });
    if (!result.ok) {
      toast.error(result.error || "No se pudo importar el inventario.");
      setImporting(false); return;
    }
    toast.success(`${rows.length} items de inventario importados`);
    try { await onImported(); } catch { toast.error("El inventario se importó, pero no se pudo actualizar la vista."); }
    finally { setImporting(false); setOpen(false); reset(); }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <Button variant="outline" onClick={() => setOpen(true)} disabled={readOnly}><Upload className="mr-1.5 h-4 w-4" />Importar CSV</Button>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Importar inventario desde CSV</DialogTitle>
          <DialogDescription>Cargá el stock actual de cada insumo. No se crean movimientos ni asientos contables.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="rounded-lg border border-dashed border-border p-4 text-sm">
            <input ref={inputRef} type="file" accept=".csv,text/csv" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void readFile(file); }} />
            <Button variant="outline" onClick={() => inputRef.current?.click()} disabled={reading || importing}><Upload className="mr-1.5 h-4 w-4" />{reading ? "Leyendo…" : "Elegir archivo CSV"}</Button>
            {fileName && <span className="ml-3 text-muted-foreground">{fileName}</span>}
            <p className="mt-2 text-xs text-muted-foreground">Máximo 200 filas y 1 MB. Acepta importes como 1.250,50. Columnas: nombre, categoría, unidad, stock, mínimo, costo y moneda.</p>
            <a href="/plantilla-inventario.csv" download className="mt-2 inline-block text-xs font-medium text-primary hover:underline">Descargar plantilla CSV</a>
          </div>
          {errors.length > 0 && <div role="alert" className="rounded-lg border border-red-500/25 bg-red-500/5 p-3 text-sm"><div className="flex items-center gap-2 font-medium text-red-700 dark:text-red-300"><AlertTriangle className="h-4 w-4" /> Corregí el archivo antes de importar</div><ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">{errors.slice(0, 8).map((error, index) => <li key={`${error}-${index}`}>{error}</li>)}</ul>{errors.length > 8 && <p className="mt-1 text-xs text-muted-foreground">Hay {errors.length - 8} errores más.</p>}</div>}
          {rows.length > 0 && <div className="rounded-lg border border-border p-3"><div className="flex items-center gap-2 text-sm font-medium"><CheckCircle2 className="h-4 w-4 text-emerald-500" />{rows.length} filas listas para revisar</div><div className="mt-2 max-h-40 overflow-auto text-xs text-muted-foreground">{rows.slice(0, 5).map((row, index) => <p key={`${row.name}-${index}`} className="border-t border-border py-1.5">{row.name} · {row.currentStock} {row.unit} · {row.category}</p>)}{rows.length > 5 && <p className="pt-1.5">…y {rows.length - 5} filas más</p>}</div></div>}
        </div>
        <DialogFooter><DialogClose asChild><Button variant="outline" disabled={importing || reading}>Cancelar</Button></DialogClose><Button onClick={() => void importRows()} disabled={importing || reading || rows.length === 0 || errors.length > 0}>{importing ? "Importando…" : "Importar items"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
