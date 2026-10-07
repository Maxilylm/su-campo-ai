"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Camera, FileSpreadsheet, ImageUp, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CattlePreviewTable, InventoryPreviewTable } from "@/components/import/ImportPreview";
import {
  CATTLE_HEADER_KEYS, MAX_IMPORT_ROWS, cattleImportPayload, emptyCattleDraft, resolveDraftSections, validateCattleDrafts,
  type CattleDraft, type DraftValidation, type SectionOption,
} from "@/lib/cattle-import";
import { INVENTORY_HEADER_KEYS, emptyInventoryDraft, inventoryImportPayload, validateInventoryDrafts, type InventoryDraft } from "@/lib/inventory-import";
import { SAMPLE_MAX_ROWS, type ImportTarget, type PhotoExtraction, type RequestedImportTarget, type SheetMappingResult } from "@/lib/ai-import";
import { pickSheet, type ImportTable, type SheetGrid } from "@/lib/import-table";
import { draftsFromTable, importTargetLabel, interpretTable, type ImportDrafts, type TableInterpretation } from "@/lib/smart-import";
import { SPREADSHEET_ACCEPT, SpreadsheetReadError, readSpreadsheetFile, spreadsheetKind } from "@/lib/spreadsheet-file";
import { downscaleImageToDataUrl } from "@/lib/image-downscale";
import { fetchWithTimeout } from "@/lib/fetch";
import { createIdempotencyKey, notifyDataChanged } from "@/lib/mutate";

// One import flow for every source: a CSV/Excel file read in the browser
// (columns recognized by name, or mapped by the AI when they aren't), or a
// photo read by the vision model. Every path ends in the same editable
// preview, validated with the endpoint's rules, and writes only through the
// existing /api/cattle/import and /api/inventory/import endpoints.

type Origin = "columns" | "ai-columns" | "ai-photo";

type Source =
  | { kind: "sheet"; fileName: string; sheets: SheetGrid[]; sheetNames: string[]; table: ImportTable }
  | { kind: "photo"; fileName: string; dataUrl: string };

interface Preview {
  result: ImportDrafts;
  origin: Origin;
  warnings: string[];
  skipped: number;
  confidence?: PhotoExtraction["confidence"];
}

const AI_SHEET_TIMEOUT_MS = 30_000;
const AI_PHOTO_TIMEOUT_MS = 65_000;
const IMPORT_TIMEOUT_MS = 30_000;

type AiResponse<T> = { ok: true; data: T } | { ok: false; error: string };

async function postAiImport<T>(body: Record<string, unknown>, timeoutMs: number): Promise<AiResponse<T>> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return { ok: false, error: "Sin conexión. La lectura con IA necesita internet." };
  try {
    const res = await fetchWithTimeout("/api/ai/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }, timeoutMs);
    const payload = await res.json().catch(() => null);
    if (res.ok && payload) return { ok: true, data: payload as T };
    const message = payload && typeof payload.error === "string" ? payload.error : res.status === 413 ? "La foto es demasiado grande." : "No se pudo analizar con IA.";
    return { ok: false, error: message };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return { ok: false, error: "La IA tardó demasiado. Intentá de nuevo." };
    return { ok: false, error: "No se pudo conectar con el servidor." };
  }
}

/** Server row errors say "Fila N" counting a CSV header line; the preview numbers rows from 1. */
function previewRowError(message: string): string {
  return message.replace(/^Fila (\d+):/, (_, line: string) => `Fila ${Math.max(1, Number(line) - 1)}:`);
}

function headerKeys(target: RequestedImportTarget): ReadonlySet<string> {
  if (target === "cattle") return CATTLE_HEADER_KEYS;
  if (target === "inventory") return INVENTORY_HEADER_KEYS;
  return new Set([...CATTLE_HEADER_KEYS, ...INVENTORY_HEADER_KEYS]);
}

const ORIGIN_TEXT: Record<Origin, string> = {
  "columns": "Columnas reconocidas por nombre.",
  "ai-columns": "La IA interpretó las columnas de la planilla. Revisá cada fila antes de importar.",
  "ai-photo": "La IA leyó la foto. Revisá cada fila contra la planilla antes de importar.",
};

export interface SmartImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What the rows become; "auto" (chat) detects it and lets the user switch. */
  target: RequestedImportTarget;
  sections: readonly SectionOption[];
  readOnly: boolean;
  onImported?: () => Promise<void> | void;
  /** A file picked elsewhere (the chat's attach button), processed on open. */
  initialFile?: File | null;
}

export function SmartImportDialog({ open, onOpenChange, target, sections, readOnly, onImported, initialFile }: SmartImportDialogProps) {
  const sheetInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const requestIdRef = useRef(0);
  const importKeyRef = useRef<string | null>(null);
  const handledInitialFileRef = useRef<File | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [serverErrors, setServerErrors] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const busy = Boolean(working) || importing;

  function reset() {
    requestIdRef.current += 1;
    importKeyRef.current = null;
    setSource(null);
    setPreview(null);
    setWorking(null);
    setError(null);
    setServerErrors([]);
    for (const ref of [sheetInputRef, cameraInputRef, galleryInputRef]) if (ref.current) ref.current.value = "";
  }

  function handleOpenChange(next: boolean) {
    if (!next && importing) return;
    if (!next) {
      reset();
      handledInitialFileRef.current = null;
    }
    onOpenChange(next);
  }

  function showPreview(next: Preview) {
    importKeyRef.current = createIdempotencyKey();
    setServerErrors([]);
    const total = next.result.drafts.length;
    if (total > MAX_IMPORT_ROWS) {
      const result: ImportDrafts = next.result.target === "cattle"
        ? { target: "cattle", drafts: next.result.drafts.slice(0, MAX_IMPORT_ROWS) }
        : { target: "inventory", drafts: next.result.drafts.slice(0, MAX_IMPORT_ROWS) };
      next = {
        ...next,
        result,
        warnings: [...next.warnings, `La planilla tiene ${total} filas; se importan las primeras ${MAX_IMPORT_ROWS}. Cargá el resto en otra planilla.`],
      };
    }
    setPreview(next);
  }

  async function interpretSheet(table: ImportTable, requested: RequestedImportTarget, requestId: number, forceAi = false) {
    const { interpretation, confident } = interpretTable(table, requested);
    if (interpretation && confident && !forceAi) {
      const built = draftsFromTable(table, interpretation, sections);
      showPreview({ result: built, origin: "columns", warnings: [], skipped: built.skipped });
      return;
    }
    if (table.rows.length === 0) {
      setError("La planilla no tiene filas de datos debajo de los encabezados.");
      return;
    }
    setWorking("Analizando las columnas con IA…");
    const response = await postAiImport<SheetMappingResult>({
      mode: "sheet",
      target: requested,
      headers: table.headers,
      rows: table.rows.slice(0, SAMPLE_MAX_ROWS),
    }, AI_SHEET_TIMEOUT_MS);
    if (requestId !== requestIdRef.current) return;
    if (response.ok) {
      const ai = response.data;
      const mapped: TableInterpretation = ai.target === "cattle" ? { target: "cattle", mapping: ai.mapping } : { target: "inventory", mapping: ai.mapping };
      const built = draftsFromTable(table, mapped, sections);
      showPreview({ result: built, origin: "ai-columns", warnings: ai.warnings ?? [], skipped: built.skipped });
      return;
    }
    if (interpretation) {
      const built = draftsFromTable(table, interpretation, sections);
      showPreview({ result: built, origin: "columns", warnings: [`No se pudo usar la IA (${response.error}). Se usaron las columnas reconocidas por nombre.`], skipped: built.skipped });
      return;
    }
    setError(`${response.error} Usá la plantilla CSV o renombrá las columnas (categoría, cantidad, potrero…).`);
  }

  async function readSheet(file: File, requested: RequestedImportTarget, requestId: number) {
    setWorking("Leyendo la planilla…");
    const sheets = await readSpreadsheetFile(file);
    if (requestId !== requestIdRef.current) return;
    const picked = pickSheet(sheets, headerKeys(requested));
    if (!picked || picked.table.headers.length === 0) {
      setError("El archivo no tiene datos.");
      return;
    }
    setSource({ kind: "sheet", fileName: file.name, sheets, sheetNames: picked.sheetNames, table: picked.table });
    await interpretSheet(picked.table, requested, requestId);
  }

  async function readPhoto(dataUrl: string, requested: RequestedImportTarget, requestId: number) {
    setWorking("Leyendo la foto con IA… puede tardar hasta un minuto.");
    const response = await postAiImport<PhotoExtraction>({ mode: "photo", target: requested, image: dataUrl }, AI_PHOTO_TIMEOUT_MS);
    if (requestId !== requestIdRef.current) return;
    if (!response.ok) {
      setError(response.error);
      return;
    }
    const data = response.data;
    const result: ImportDrafts = data.target === "cattle"
      ? { target: "cattle", drafts: resolveDraftSections(data.rows, sections) }
      : { target: "inventory", drafts: data.rows };
    showPreview({ result, origin: "ai-photo", warnings: data.warnings ?? [], skipped: 0, confidence: data.confidence });
  }

  async function handleFile(file: File) {
    const requestId = ++requestIdRef.current;
    setError(null);
    setPreview(null);
    setSource(null);
    try {
      if (spreadsheetKind(file.name, file.type) === "image") {
        setWorking("Preparando la foto…");
        const dataUrl = await downscaleImageToDataUrl(file);
        if (requestId !== requestIdRef.current) return;
        setSource({ kind: "photo", fileName: file.name, dataUrl });
        await readPhoto(dataUrl, target, requestId);
      } else {
        await readSheet(file, target, requestId);
      }
    } catch (caught) {
      if (requestId !== requestIdRef.current) return;
      setError(caught instanceof SpreadsheetReadError ? caught.message : "No se pudo leer el archivo. Probá con otro formato o una foto más chica.");
    } finally {
      if (requestId === requestIdRef.current) setWorking(null);
    }
  }

  async function rerun(requested: RequestedImportTarget, options: { sheetName?: string; forceAi?: boolean } = {}) {
    if (!source) return;
    const requestId = ++requestIdRef.current;
    setError(null);
    setPreview(null);
    try {
      if (source.kind === "photo") {
        await readPhoto(source.dataUrl, requested, requestId);
        return;
      }
      let table = source.table;
      if (options.sheetName && options.sheetName !== table.sheetName) {
        const picked = pickSheet(source.sheets, headerKeys(requested), options.sheetName);
        if (!picked) { setError("Esa hoja está vacía."); return; }
        table = picked.table;
        setSource({ ...source, table });
      }
      await interpretSheet(table, requested, requestId, options.forceAi);
    } catch {
      if (requestId === requestIdRef.current) setError("No se pudo volver a leer el archivo.");
    } finally {
      if (requestId === requestIdRef.current) setWorking(null);
    }
  }

  // The chat hands a file over; read it once per open.
  useEffect(() => {
    if (!open || !initialFile || handledInitialFileRef.current === initialFile) return;
    handledInitialFileRef.current = initialFile;
    void handleFile(initialFile);
    // handleFile reads the latest props through closures; re-running on its identity would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialFile]);

  const validation: DraftValidation | null = useMemo(() => {
    if (!preview) return null;
    return preview.result.target === "cattle"
      ? validateCattleDrafts(preview.result.drafts, sections)
      : validateInventoryDrafts(preview.result.drafts);
  }, [preview, sections]);

  function updateCattle(index: number, patch: Partial<CattleDraft>) {
    setPreview((current) => current && current.result.target === "cattle"
      ? { ...current, result: { target: "cattle", drafts: current.result.drafts.map((draft, i) => (i === index ? { ...draft, ...patch } : draft)) } }
      : current);
  }

  function updateInventory(index: number, patch: Partial<InventoryDraft>) {
    setPreview((current) => current && current.result.target === "inventory"
      ? { ...current, result: { target: "inventory", drafts: current.result.drafts.map((draft, i) => (i === index ? { ...draft, ...patch } : draft)) } }
      : current);
  }

  function deleteRow(index: number) {
    setPreview((current) => {
      if (!current) return current;
      const result: ImportDrafts = current.result.target === "cattle"
        ? { target: "cattle", drafts: current.result.drafts.filter((_, i) => i !== index) }
        : { target: "inventory", drafts: current.result.drafts.filter((_, i) => i !== index) };
      return { ...current, result };
    });
  }

  function addRow() {
    setPreview((current) => {
      if (!current) return current;
      const result: ImportDrafts = current.result.target === "cattle"
        ? { target: "cattle", drafts: [...current.result.drafts, emptyCattleDraft()] }
        : { target: "inventory", drafts: [...current.result.drafts, emptyInventoryDraft()] };
      return { ...current, result };
    });
  }

  async function importRows() {
    if (!preview || !validation?.valid || readOnly || importing) return;
    const { result } = preview;
    const endpoint = result.target === "cattle" ? "/api/cattle/import" : "/api/inventory/import";
    const rows = result.target === "cattle" ? cattleImportPayload(result.drafts) : inventoryImportPayload(result.drafts);
    const key = importKeyRef.current || createIdempotencyKey();
    importKeyRef.current = key;
    setImporting(true);
    setServerErrors([]);
    try {
      const res = await fetchWithTimeout(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify({ rows }),
      }, IMPORT_TIMEOUT_MS);
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        const rowErrors = Array.isArray(payload?.rowErrors) ? payload.rowErrors.filter((item: unknown): item is string => typeof item === "string").map(previewRowError) : [];
        setServerErrors([typeof payload?.error === "string" ? payload.error : "No se pudo importar.", ...rowErrors]);
        setImporting(false);
        return;
      }
      notifyDataChanged();
      const what = result.target === "cattle" ? "registros de hacienda" : "items de inventario";
      toast.success(`${rows.length} ${what} importados`);
    } catch (caught) {
      setServerErrors([caught instanceof Error && caught.name === "AbortError"
        ? "La importación tardó demasiado. Revisá si se guardó antes de reintentar."
        : "No se pudo conectar con el servidor."]);
      setImporting(false);
      return;
    }
    try {
      await onImported?.();
    } catch {
      toast.error("Se importó, pero no se pudo actualizar la vista.");
    }
    setImporting(false);
    reset();
    handledInitialFileRef.current = null;
    onOpenChange(false);
  }

  const result = preview?.result ?? null;
  const currentTarget: ImportTarget | null = result?.target ?? (target === "auto" ? null : target);
  const title = currentTarget === "inventory" ? "Importar inventario" : currentTarget === "cattle" ? "Importar hacienda" : "Importar planilla o foto";
  const rowCount = result?.drafts.length ?? 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Subí una planilla Excel o CSV, o sacale una foto a la planilla en papel. Revisás y corregís cada fila antes de guardar.
          </DialogDescription>
        </DialogHeader>

        <input ref={sheetInputRef} type="file" accept={SPREADSHEET_ACCEPT} className="sr-only" tabIndex={-1} aria-label="Archivo Excel o CSV" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void handleFile(file); }} />
        <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-label="Sacar foto de la planilla" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void handleFile(file); }} />
        <input ref={galleryInputRef} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-label="Elegir foto de la planilla" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void handleFile(file); }} />

        <div className="grid min-w-0 gap-4">
          <div className="grid gap-2 sm:grid-cols-3" role="group" aria-label="Origen de los datos">
            <Button variant="outline" className="h-auto min-h-11 justify-start whitespace-normal py-2 text-left" onClick={() => sheetInputRef.current?.click()} disabled={busy}>
              <FileSpreadsheet aria-hidden="true" />Planilla Excel o CSV
            </Button>
            <Button variant="outline" className="h-auto min-h-11 justify-start whitespace-normal py-2 text-left" onClick={() => cameraInputRef.current?.click()} disabled={busy}>
              <Camera aria-hidden="true" />Sacar foto
            </Button>
            <Button variant="outline" className="h-auto min-h-11 justify-start whitespace-normal py-2 text-left" onClick={() => galleryInputRef.current?.click()} disabled={busy}>
              <ImageUp aria-hidden="true" />Elegir foto
            </Button>
          </div>
          {!source && !working && !error && (
            <p className="text-xs text-muted-foreground">
              Sirve un registro de hacienda, un balance o inventario de hacienda (Categoría | Cantidad | Peso | Potrero), una declaración DICOSE, una lista de caravanas o un inventario de insumos.
              Si las columnas no tienen los nombres de la plantilla, la IA las interpreta. Hasta <span className="figure text-foreground">{MAX_IMPORT_ROWS}</span> filas por vez.
              {" "}
              <a href={currentTarget === "inventory" ? "/plantilla-inventario.csv" : "/plantilla-hacienda.csv"} download className="font-medium text-primary hover:underline">Descargar plantilla CSV</a>
            </p>
          )}

          {source && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
              <span className="min-w-0 break-all text-muted-foreground">{source.fileName}</span>
              {source.kind === "sheet" && source.sheetNames.length > 1 && (
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  Hoja
                  <select
                    className="h-9 rounded-md border border-input bg-card px-2 text-sm text-foreground pointer-coarse:min-h-11"
                    value={source.table.sheetName ?? ""}
                    disabled={busy}
                    onChange={(event) => void rerun(currentTarget ?? target, { sheetName: event.target.value })}
                  >
                    {source.sheetNames.map((name) => <option key={name} value={name}>{name}</option>)}
                  </select>
                </label>
              )}
              {target === "auto" && result && (
                <div className="flex items-center gap-1" role="group" aria-label="Qué estás importando">
                  {(["cattle", "inventory"] as const).map((option) => (
                    <Button key={option} size="sm" variant={result.target === option ? "default" : "outline"} aria-pressed={result.target === option} disabled={busy} onClick={() => { if (result.target !== option) void rerun(option); }}>
                      {importTargetLabel(option)}
                    </Button>
                  ))}
                </div>
              )}
              {source.kind === "sheet" && preview?.origin === "columns" && (
                <Button size="sm" variant="ghost" disabled={busy || readOnly} onClick={() => void rerun(currentTarget ?? target, { forceAi: true })}>
                  <Sparkles aria-hidden="true" />Interpretar con IA
                </Button>
              )}
            </div>
          )}

          {working && (
            <div role="status" className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{working}
            </div>
          )}

          {error && (
            <div role="alert" className="flex items-start gap-2 rounded-lg border border-bad-line bg-bad-soft p-3 text-sm text-foreground">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-bad" aria-hidden="true" />{error}
            </div>
          )}

          {preview && validation && (
            <>
              <div className="rounded-lg border border-info-line bg-info-soft p-3 text-sm text-foreground">
                <p className="flex items-center gap-2 font-medium">
                  {preview.origin !== "columns" && <Sparkles className="h-4 w-4 text-info" aria-hidden="true" />}
                  <span className="figure">{rowCount}</span> {rowCount === 1 ? "fila" : "filas"} de {importTargetLabel(preview.result.target).toLowerCase()}
                  {preview.confidence && <span className="font-normal text-muted-foreground">· lectura con confianza {preview.confidence}</span>}
                </p>
                <p className="mt-1 text-xs">{ORIGIN_TEXT[preview.origin]}{preview.skipped > 0 ? ` Se omitieron ${preview.skipped} filas vacías o de totales.` : ""}</p>
                {preview.warnings.length > 0 && (
                  <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs">
                    {preview.warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}
                  </ul>
                )}
              </div>

              {preview.result.target === "cattle" ? (
                <CattlePreviewTable drafts={preview.result.drafts} validation={validation} sections={sections} disabled={importing} onChange={updateCattle} onDelete={deleteRow} onAdd={addRow} />
              ) : (
                <InventoryPreviewTable drafts={preview.result.drafts} validation={validation} disabled={importing} onChange={updateInventory} onDelete={deleteRow} onAdd={addRow} />
              )}

              {(validation.errors.length > 0 || serverErrors.length > 0 || !validation.valid) && (
                <div role="alert" className="rounded-lg border border-bad-line bg-bad-soft p-3 text-sm">
                  <p className="flex items-center gap-2 font-medium text-bad"><AlertTriangle className="h-4 w-4" aria-hidden="true" />
                    {serverErrors.length > 0 ? "El servidor rechazó la importación" : "Corregí las filas marcadas antes de importar"}
                  </p>
                  {[...validation.errors, ...serverErrors].length > 0 && (
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-foreground">
                      {[...validation.errors, ...serverErrors].slice(0, 12).map((message, index) => <li key={`${message}-${index}`}>{message}</li>)}
                    </ul>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={importing}>Cancelar</Button>
          <Button onClick={() => void importRows()} disabled={readOnly || busy || !validation?.valid} title={readOnly ? "Necesitás conexión y permiso de edición para importar" : undefined}>
            {importing ? "Importando…" : rowCount > 0 ? `Importar ${rowCount} ${rowCount === 1 ? "fila" : "filas"}` : "Importar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
