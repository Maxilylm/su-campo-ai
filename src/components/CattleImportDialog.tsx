"use client";

import { useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { parseCSV } from "@/lib/csv";
import { isValidCattleCategory, normalizedEarTag } from "@/lib/cattle";
import { createIdempotencyKey, sendJsonResult } from "@/lib/mutate";
import { parseLocalizedNumber } from "@/lib/number";

interface SectionOption { id: string; name: string }

interface ImportRow {
  sectionId: string | null;
  sectionName: string;
  category: string;
  count: number;
  breed: string | null;
  weightKg: number | null;
  earTag: string | null;
  tagRange: string | null;
  birthDate: string | null;
  origin: string | null;
  vaccinationStatus: string | null;
  reproductiveStatus: string | null;
  healthStatus: string | null;
  notes: string | null;
}

const MAX_FILE_BYTES = 1_000_000;
const MAX_ROWS = 200;

function normalizeKey(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
}

function findColumn(headers: string[], aliases: string[]): number {
  const normalized = headers.map(normalizeKey);
  return normalized.findIndex((header) => aliases.includes(header));
}

function rowValue(row: string[], index: number): string {
  return index >= 0 ? (row[index] || "").trim() : "";
}

function numericOrNull(value: string): number | null {
  if (!value) return null;
  const parsed = parseLocalizedNumber(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export function CattleImportDialog({
  sections,
  readOnly,
  onImported,
}: {
  sections: SectionOption[];
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
    setFileName("");
    setRows([]);
    setErrors([]);
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
    setFileName(file.name);
    setRows([]);
    setErrors([]);
    importBatchKeyRef.current = null;
    if (file.size > MAX_FILE_BYTES) {
      setErrors(["El archivo supera el límite de 1 MB."]);
      return;
    }
    importBatchKeyRef.current = createIdempotencyKey();
    setReading(true);
    try {
      const parsed = parseCSV(await file.text());
      if (requestId !== readRequestIdRef.current) return;
      if (parsed.headers.length === 0 || parsed.rows.length === 0) {
        setErrors(["El CSV no tiene encabezados y filas de datos."]);
        return;
      }
      const aliases = {
        section: ["section", "seccion", "potrero", "lote", "sectionname", "seccionname", "sectionid"],
        category: ["category", "categoria", "tipo", "clase"],
        count: ["count", "cantidad", "cabezas", "headcount"],
        breed: ["breed", "raza"],
        weight: ["weightkg", "weight", "peso", "pesokg"],
        earTag: ["eartag", "caravana", "tag", "identificacion"],
        tagRange: ["tagrange", "rangocaravanas", "rango"],
        birthDate: ["birthdate", "fechanacimiento", "nacimiento"],
        origin: ["origin", "origen"],
        vaccinationStatus: ["vaccinationstatus", "estadovacuna", "vacunacion"],
        reproductiveStatus: ["reproductivestatus", "estadoreproductivo", "reproduccion"],
        healthStatus: ["healthstatus", "estadosanitario", "salud"],
        notes: ["notes", "notas", "observaciones"],
      };
      const columns = Object.fromEntries(Object.entries(aliases).map(([key, values]) => [key, findColumn(parsed.headers, values)])) as Record<keyof typeof aliases, number>;
      const sectionByName = new Map(sections.map((section) => [normalizeKey(section.name), section]));
      const sectionById = new Map(sections.map((section) => [section.id, section]));
      const nextRows: ImportRow[] = [];
      const nextErrors: string[] = [];
      const seenEarTags = new Map<string, number>();

      if (columns.category < 0) nextErrors.push("Falta la columna categoría (category o categoria).");
      if (parsed.rows.length > MAX_ROWS) nextErrors.push(`El archivo tiene ${parsed.rows.length} filas; el máximo es ${MAX_ROWS}.`);

      parsed.rows.slice(0, MAX_ROWS).forEach((row, index) => {
        const line = index + 2;
        const sectionName = rowValue(row, columns.section);
        const section = sectionByName.get(normalizeKey(sectionName)) || sectionById.get(sectionName);
        const category = rowValue(row, columns.category) || "vaca";
        const countValue = rowValue(row, columns.count);
        const weightValue = numericOrNull(rowValue(row, columns.weight));
        const count = countValue ? Number(countValue) : 1;
        const birthDate = rowValue(row, columns.birthDate) || null;
        const earTag = rowValue(row, columns.earTag) || null;
        const normalizedTag = normalizedEarTag(earTag);
        if (sectionName && !section) nextErrors.push(`Fila ${line}: no encontré la sección «${sectionName}».`);
        if (!isValidCattleCategory(category)) nextErrors.push(`Fila ${line}: categoría «${category}» inválida.`);
        if (!Number.isInteger(count) || count < 1) nextErrors.push(`Fila ${line}: cantidad inválida.`);
        if (weightValue !== null && (!Number.isFinite(weightValue) || weightValue <= 0)) nextErrors.push(`Fila ${line}: peso inválido.`);
        if (birthDate && !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) nextErrors.push(`Fila ${line}: fecha debe usar AAAA-MM-DD.`);
        if (normalizedTag) {
          const previousLine = seenEarTags.get(normalizedTag);
          if (previousLine) nextErrors.push(`Fila ${line}: la caravana «${earTag}» también aparece en la fila ${previousLine}.`);
          else seenEarTags.set(normalizedTag, line);
        }
        nextRows.push({
          sectionId: section?.id || null,
          sectionName: section?.name || sectionName || "Sin sección",
          category,
          count,
          breed: rowValue(row, columns.breed) || null,
          weightKg: weightValue,
          earTag,
          tagRange: rowValue(row, columns.tagRange) || null,
          birthDate,
          origin: rowValue(row, columns.origin) || null,
          vaccinationStatus: rowValue(row, columns.vaccinationStatus) || null,
          reproductiveStatus: rowValue(row, columns.reproductiveStatus) || null,
          healthStatus: rowValue(row, columns.healthStatus) || null,
          notes: rowValue(row, columns.notes) || null,
        });
      });
      setRows(nextRows);
      setErrors(nextErrors);
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
    const result = await sendJsonResult("/api/cattle/import", "POST", {
      rows: rows.map((row) => ({
        sectionId: row.sectionId,
        category: row.category,
        count: row.count,
        breed: row.breed,
        weightKg: row.weightKg,
        earTag: row.earTag,
        tagRange: row.tagRange,
        birthDate: row.birthDate,
        origin: row.origin,
        vaccinationStatus: row.vaccinationStatus,
        reproductiveStatus: row.reproductiveStatus,
        healthStatus: row.healthStatus,
        notes: row.notes,
      })),
    }, { idempotencyKey: importBatchKey, timeoutMs: 30000 });
    if (!result.ok) {
      toast.error(result.error || "No se pudo importar la hacienda.");
      setImporting(false);
      return;
    }
    toast.success(`${rows.length} registros de hacienda importados`);
    try {
      await onImported();
    } catch {
      toast.error("La hacienda se importó, pero no se pudo actualizar la vista.");
    } finally {
      setImporting(false);
      setOpen(false);
      reset();
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <Button variant="outline" onClick={() => setOpen(true)} disabled={readOnly}>
        <Upload className="mr-1.5 h-4 w-4" />Importar CSV
      </Button>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Importar hacienda desde CSV</DialogTitle>
          <DialogDescription>Subí una planilla con encabezados. La importación valida todas las filas antes de guardarlas.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="rounded-lg border border-dashed border-border p-4 text-sm">
            <input ref={inputRef} type="file" accept=".csv,text/csv" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void readFile(file); }} />
            <Button variant="outline" onClick={() => inputRef.current?.click()} disabled={reading || importing}>
              <Upload className="mr-1.5 h-4 w-4" />{reading ? "Leyendo…" : "Elegir archivo CSV"}
            </Button>
            {fileName && <span className="ml-3 text-muted-foreground">{fileName}</span>}
            <p className="mt-2 text-xs text-muted-foreground">Máximo 200 filas y 1 MB. Acepta pesos como 420,5 o 1.250,50. Columnas: categoria, cantidad, raza, seccion, peso, caravana, fecha_nacimiento y notas.</p>
            <a href="/plantilla-hacienda.csv" download className="mt-2 inline-block text-xs font-medium text-primary hover:underline">Descargar plantilla CSV</a>
          </div>

          {errors.length > 0 && (
            <div role="alert" className="rounded-lg border border-red-500/25 bg-red-500/5 p-3 text-sm">
              <div className="flex items-center gap-2 font-medium text-red-700 dark:text-red-300"><AlertTriangle className="h-4 w-4" /> Corregí el archivo antes de importar</div>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">{errors.slice(0, 8).map((error, index) => <li key={`${error}-${index}`}>{error}</li>)}</ul>
              {errors.length > 8 && <p className="mt-1 text-xs text-muted-foreground">Hay {errors.length - 8} errores más.</p>}
            </div>
          )}

          {rows.length > 0 && (
            <div className="rounded-lg border border-border p-3">
              <div className="flex items-center gap-2 text-sm font-medium"><CheckCircle2 className="h-4 w-4 text-emerald-500" />{rows.length} filas listas para revisar</div>
              <div className="mt-2 max-h-40 overflow-auto text-xs text-muted-foreground">
                {rows.slice(0, 5).map((row, index) => <p key={`${row.category}-${index}`} className="border-t border-border py-1.5">{row.sectionName} · {row.category} · {row.count} cabezas{row.breed ? ` · ${row.breed}` : ""}</p>)}
                {rows.length > 5 && <p className="pt-1.5">…y {rows.length - 5} filas más</p>}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild><Button variant="outline" disabled={importing || reading}>Cancelar</Button></DialogClose>
          <Button onClick={() => void importRows()} disabled={readOnly || importing || reading || rows.length === 0 || errors.length > 0} title={readOnly ? "Necesitás conexión para importar" : undefined}>
            {importing ? "Importando…" : "Importar registros"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
