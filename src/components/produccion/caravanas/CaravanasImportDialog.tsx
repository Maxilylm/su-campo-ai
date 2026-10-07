"use client";

import { useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  MAX_CARAVANA_IMPORT_ROWS, caravanaDisplay, categoryLabel, csvToGrid, parseCaravanaSheet, sexLabel, summarizeCaravanaRows,
  type CaravanaSheetResult, type SheetRow,
} from "@/lib/caravanas";
import { createIdempotencyKey, sendJsonResult } from "@/lib/mutate";
import { NONE, type LoteOption, type SectionOption } from "./types";

const MAX_FILE_BYTES = 5_000_000;

function isExcelFile(file: File): boolean {
  return /\.xlsx$/i.test(file.name) || file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
}

async function readGrid(file: File): Promise<SheetRow[]> {
  if (isExcelFile(file)) {
    // Loaded on demand: the Excel reader only ships to people who import.
    const { readSheet } = await import("read-excel-file/browser");
    return await readSheet(file) as SheetRow[];
  }
  return csvToGrid(await file.text());
}

function countChips(record: Record<string, number>, label: (key: string) => string) {
  return Object.entries(record).sort((a, b) => b[1] - a[1]).map(([key, n]) => `${label(key)} ${n.toLocaleString("es-UY")}`).join(" · ");
}

export function CaravanasImportDialog({
  lotes, sections, readOnly, onImported, open: controlledOpen, onOpenChange: setControlledOpen,
}: {
  /** Optional control, so an empty state elsewhere on the page can open it. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  lotes: LoteOption[];
  sections: SectionOption[];
  readOnly: boolean;
  onImported: () => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const batchKeyRef = useRef<string | null>(null);
  const readRequestRef = useRef(0);
  const [ownOpen, setOwnOpen] = useState(false);
  const open = controlledOpen ?? ownOpen;
  const setOpen = (next: boolean) => {
    setOwnOpen(next);
    setControlledOpen?.(next);
  };
  const [fileName, setFileName] = useState("");
  const [excel, setExcel] = useState(false);
  const [result, setResult] = useState<CaravanaSheetResult | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [loteId, setLoteId] = useState(NONE);
  const [sectionId, setSectionId] = useState(NONE);

  function reset() {
    readRequestRef.current += 1;
    setFileName("");
    setResult(null);
    setReadError(null);
    setLoteId(NONE);
    setSectionId(NONE);
    batchKeyRef.current = null;
    if (inputRef.current) inputRef.current.value = "";
  }

  function onOpenChange(next: boolean) {
    if (!next && (reading || importing)) return;
    setOpen(next);
    if (!next) reset();
  }

  async function readFile(file: File) {
    const requestId = ++readRequestRef.current;
    setFileName(file.name);
    setExcel(isExcelFile(file));
    setResult(null);
    setReadError(null);
    batchKeyRef.current = null;
    if (file.size > MAX_FILE_BYTES) {
      setReadError("El archivo supera el límite de 5 MB.");
      return;
    }
    if (/\.xls$/i.test(file.name)) {
      setReadError("Los archivos .xls (Excel 97) no se pueden leer. Guardalo como .xlsx o CSV e intentá de nuevo.");
      return;
    }
    setReading(true);
    try {
      const grid = await readGrid(file);
      if (requestId !== readRequestRef.current) return;
      setResult(parseCaravanaSheet(grid));
      batchKeyRef.current = createIdempotencyKey();
    } catch (error) {
      console.error("Caravanas file read error:", error);
      if (requestId === readRequestRef.current) setReadError("No se pudo leer el archivo. Probá exportarlo de nuevo como .xlsx o CSV.");
    } finally {
      if (requestId === readRequestRef.current) setReading(false);
    }
  }

  // Changing the assignment changes what the batch writes: a new key, so a
  // retry of the previous choice is not mistaken for this one.
  function changeLote(value: string) {
    setLoteId(value);
    if (value !== NONE) setSectionId(NONE);
    if (result) batchKeyRef.current = createIdempotencyKey();
  }
  function changeSection(value: string) {
    setSectionId(value);
    if (result) batchKeyRef.current = createIdempotencyKey();
  }

  const rows = result?.rows ?? [];
  const canImport = !readOnly && !reading && !importing && Boolean(result) && !result?.fatal && rows.length > 0;
  const skipped = (result?.errors.length ?? 0);
  const preview = summarizeCaravanaRows(rows);

  async function importRows() {
    if (!canImport || !result) return;
    setImporting(true);
    const key = batchKeyRef.current || createIdempotencyKey();
    batchKeyRef.current = key;
    const response = await sendJsonResult("/api/caravanas/import", "POST", {
      source: result.snigLayout ? "snig_import" : "excel",
      cattleId: loteId === NONE ? null : loteId,
      sectionId: loteId === NONE && sectionId !== NONE ? sectionId : null,
      rows: rows.map((row) => ({
        line: row.line,
        tagNumber: row.tagNumber,
        visualTag: row.visualTag,
        sex: row.sex,
        breed: row.breed,
        category: row.category,
        birthDate: row.birthDate,
        status: row.status,
        notes: row.notes,
      })),
    }, { idempotencyKey: key, timeoutMs: 35_000 });
    if (!response.ok) {
      toast.error(response.error || "No se pudieron importar las caravanas.");
      setImporting(false);
      return;
    }
    toast.success(`${rows.length.toLocaleString("es-UY")} caravanas importadas`, {
      description: "Las que ya existían se actualizaron solo con los datos que trae el archivo.",
    });
    try {
      await onImported();
    } catch {
      toast.error("Las caravanas se importaron, pero no se pudo actualizar la vista.");
    } finally {
      setImporting(false);
      setOpen(false);
      reset();
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <Button variant="outline" onClick={() => setOpen(true)} disabled={readOnly}>
        <Upload className="h-4 w-4" aria-hidden="true" />Importar SNIG
      </Button>
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Importar caravanas</DialogTitle>
          <DialogDescription>
            Subí el listado de animales que descargás del SNIG o una planilla propia (Excel .xlsx o CSV). Revisamos cada fila antes de guardar; las caravanas que ya existen se actualizan sin perder lo que cargaste en CampoAI.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="rounded-lg border border-dashed border-border bg-muted/40 p-4 text-sm">
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              aria-label="Archivo de caravanas"
              tabIndex={-1}
              className="sr-only"
              onChange={(event) => { const file = event.target.files?.[0]; if (file) void readFile(file); }}
            />
            <Button variant="outline" onClick={() => inputRef.current?.click()} disabled={reading || importing}>
              <Upload className="h-4 w-4" aria-hidden="true" />{reading ? "Leyendo…" : "Elegir archivo"}
            </Button>
            {fileName && <span className="ml-3 break-all text-muted-foreground">{fileName}</span>}
            <p className="mt-3 text-xs text-muted-foreground">
              Hasta <span className="figure text-foreground">{MAX_CARAVANA_IMPORT_ROWS.toLocaleString("es-UY")}</span> caravanas y <span className="figure text-foreground">5</span> MB. Reconoce columnas como «Nro. Dispositivo», «Caravana», «Identificador», «Sexo», «Raza», «Cruza», «Fecha Nac.», «Categoría» y «Estado». Acepta 858000012345678 o UY 012345678.
            </p>
          </div>

          {readError && (
            <div role="alert" className="rounded-lg border border-bad-line bg-bad-soft p-3 text-sm">
              <div className="flex items-center gap-2 font-medium text-bad"><AlertTriangle className="h-4 w-4" aria-hidden="true" />{readError}</div>
            </div>
          )}

          {result?.fatal && (
            <div role="alert" className="rounded-lg border border-bad-line bg-bad-soft p-3 text-sm">
              <div className="flex items-center gap-2 font-medium text-bad"><AlertTriangle className="h-4 w-4" aria-hidden="true" />No se puede importar este archivo</div>
              <p className="mt-1 text-xs text-foreground">{result.fatal}</p>
            </div>
          )}

          {result && !result.fatal && result.errors.length > 0 && (
            <div role="alert" className="rounded-lg border border-bad-line bg-bad-soft p-3 text-sm">
              <div className="flex items-center gap-2 font-medium text-bad">
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                {result.errors.length === 1 ? "1 fila con errores no se va a importar" : `${result.errors.length.toLocaleString("es-UY")} filas con errores no se van a importar`}
              </div>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-foreground">{result.errors.slice(0, 8).map((issue) => <li key={`e-${issue.line}`}>{issue.message}</li>)}</ul>
              {result.errors.length > 8 && <p className="mt-1 text-xs text-muted-foreground">…y {result.errors.length - 8} más. Corregí el archivo si las necesitás.</p>}
            </div>
          )}

          {result && !result.fatal && (result.duplicates.length > 0 || result.warnings.length > 0) && (
            <details className="rounded-lg border border-warn-line bg-warn-soft p-3 text-sm">
              <summary className="flex min-h-11 cursor-pointer items-center gap-2 font-medium text-warn sm:min-h-0">
                <Info className="h-4 w-4" aria-hidden="true" />
                {[
                  result.duplicates.length > 0 ? `${result.duplicates.length.toLocaleString("es-UY")} repetidas en el archivo (se importan una vez)` : null,
                  result.warnings.length > 0 ? `${result.warnings.length.toLocaleString("es-UY")} avisos` : null,
                ].filter(Boolean).join(" · ")}
              </summary>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-foreground">
                {[...result.duplicates, ...result.warnings].slice(0, 12).map((issue, index) => <li key={`w-${issue.line}-${index}`}>{issue.message}</li>)}
              </ul>
            </details>
          )}

          {result && !result.fatal && rows.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-border bg-card">
              <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 text-sm font-medium">
                <CheckCircle2 className="h-4 w-4 text-ok" aria-hidden="true" />
                <span><span className="figure">{rows.length.toLocaleString("es-UY")}</span> caravanas listas{excel ? " (Excel)" : ""}{result.snigLayout ? " · formato SNIG" : ""}</span>
              </div>
              <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
                {countChips(preview.byCategory, categoryLabel)}<br />{countChips(preview.bySex, sexLabel)}
              </p>
              <ul className="max-h-40 divide-y divide-border overflow-auto border-t border-border text-xs text-muted-foreground">
                {rows.slice(0, 5).map((row) => (
                  <li key={row.tagNumber} className="flex items-center justify-between gap-3 px-3 py-1.5">
                    <span className="font-mono text-foreground">{caravanaDisplay(row.tagNumber)}</span>
                    <span className="min-w-0 truncate">{[row.sex ? sexLabel(row.sex) : null, row.category ? categoryLabel(row.category) : null, row.breed, row.birthDate].filter(Boolean).join(" · ") || "Sin datos"}</span>
                  </li>
                ))}
                {rows.length > 5 && <li className="px-3 py-1.5">…y {(rows.length - 5).toLocaleString("es-UY")} más</li>}
              </ul>
            </div>
          )}

          {result && !result.fatal && rows.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="caravanas-import-lote">Asignar a un lote <span className="font-normal text-muted-foreground">(opcional)</span></Label>
                <Select value={loteId} onValueChange={changeLote}>
                  <SelectTrigger id="caravanas-import-lote" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>No asignar</SelectItem>
                    {lotes.map((lote) => <SelectItem key={lote.id} value={lote.id}>{lote.label} · {lote.count} cab.</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="caravanas-import-section">Asignar a un potrero <span className="font-normal text-muted-foreground">(opcional)</span></Label>
                <Select value={loteId === NONE ? sectionId : NONE} onValueChange={changeSection} disabled={loteId !== NONE}>
                  <SelectTrigger id="caravanas-import-section" className="w-full"><SelectValue placeholder="El del lote" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>{loteId === NONE ? "No asignar" : "El del lote"}</SelectItem>
                    {sections.map((section) => <SelectItem key={section.id} value={section.id}>{section.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <p className="text-xs text-muted-foreground sm:col-span-2">Si no elegís nada, las caravanas nuevas quedan sin lote y las existentes conservan su asignación.</p>
            </div>
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild><Button variant="outline" disabled={importing || reading}>Cancelar</Button></DialogClose>
          <Button onClick={() => void importRows()} disabled={!canImport}>
            {importing
              ? "Importando…"
              : skipped > 0
                ? `Importar ${rows.length.toLocaleString("es-UY")} válidas`
                : `Importar ${rows.length > 0 ? rows.length.toLocaleString("es-UY") : ""} caravanas`.replace("  ", " ")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
