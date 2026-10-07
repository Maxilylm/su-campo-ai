import { NextRequest, NextResponse } from "next/server";
import { requireFarm } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { parseJsonBody } from "@/lib/request";
import { checkRateLimit } from "@/lib/rate-limit";
import { SUPABASE_READ_TIMEOUT_MS, withTimeout } from "@/lib/timeout";
import { groqRetryAfterSec, postGroqChatCompletion } from "@/lib/ai-groq";
import { groqChatModelParams } from "@/lib/groq-model";
import { extractJsonObject } from "@/lib/json";
import { VisionError, askVisionJson, isAcceptableImageDataUrl } from "@/lib/ai-vision";
import {
  buildSheetSample, isRequestedImportTarget, normalizePhotoExtraction, normalizeSheetMapping,
  photoSystemPrompt, photoUserPrompt, sheetMappingSystemPrompt, sheetMappingUserPrompt,
} from "@/lib/ai-import";

// AI-assisted import: proposes a column mapping for an unfamiliar spreadsheet
// or reads the rows of a photographed planilla. It never writes; the client
// shows the result as an editable preview and imports through the regular,
// validated /api/cattle/import and /api/inventory/import endpoints.

// A downsized photo is ~0.3-1 MB of base64; Vercel rejects bodies over 4.5 MB.
const MAX_BODY_BYTES = 4_400_000;
const SHEET_TIMEOUT_MS = 20_000;
const PHOTO_TIMEOUT_MS = 40_000;
export const maxDuration = 60;
// Each call spends model tokens; a farm importing a few files in a row is fine.
const AI_IMPORT_RATE_LIMIT = { capacity: 8, refillPerSec: 1 / 30 };

function tooMany(retryAfterSec: number, message = "Demasiados análisis seguidos. Esperá un momento e intentá de nuevo.") {
  return NextResponse.json({ error: message }, { status: 429, headers: { "Retry-After": String(retryAfterSec) } });
}

async function mapSheet(headers: unknown, rows: unknown, target: Parameters<typeof normalizeSheetMapping>[2]) {
  const sample = buildSheetSample(headers, rows);
  if (!sample) return NextResponse.json({ error: "La planilla no tiene encabezados legibles." }, { status: 400 });
  let res: Response;
  try {
    res = await postGroqChatCompletion({
      ...groqChatModelParams(),
      temperature: 0,
      max_tokens: 2000,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: sheetMappingSystemPrompt() },
        { role: "user", content: sheetMappingUserPrompt(sample, target) },
      ],
    }, SHEET_TIMEOUT_MS);
  } catch {
    return NextResponse.json({ error: "La IA tardó demasiado en analizar la planilla. Intentá de nuevo." }, { status: 504 });
  }
  if (res.status === 429) return tooMany(groqRetryAfterSec(res), "El servicio de IA está saturado. Probá en unos segundos.");
  if (!res.ok) {
    console.error("Groq import mapping error:", res.status, await res.text().catch(() => ""));
    return NextResponse.json({ error: "No se pudo analizar la planilla con IA." }, { status: 502 });
  }
  const data = await res.json().catch(() => null);
  const content = data?.choices?.[0]?.message?.content;
  const mapping = normalizeSheetMapping(typeof content === "string" ? extractJsonObject(content) : null, sample.headers, target);
  if (!mapping) {
    return NextResponse.json({ error: "No pude reconocer columnas de hacienda ni de inventario en esta planilla.", code: "ai_import_unrecognized" }, { status: 422 });
  }
  return NextResponse.json({ mode: "sheet", ...mapping });
}

async function readPhoto(farmId: string, image: unknown, target: Parameters<typeof normalizePhotoExtraction>[1]) {
  if (!isAcceptableImageDataUrl(image)) {
    return NextResponse.json({ error: "La imagen no es válida o es demasiado grande (máximo 4 MB, JPG, PNG o WebP)." }, { status: 400 });
  }
  // Potrero names help the model read handwriting; they are data, sent escaped.
  let sectionNames: string[] = [];
  if (target !== "inventory") {
    const sections = await withTimeout(
      getSupabaseAdmin().from("sections").select("name").eq("farm_id", farmId).order("name").limit(80),
      SUPABASE_READ_TIMEOUT_MS,
      null,
    );
    if (sections && !sections.error) sectionNames = (sections.data || []).map((row) => String(row.name ?? "")).filter(Boolean);
  }
  let raw: unknown;
  try {
    raw = await askVisionJson({
      system: photoSystemPrompt(),
      prompt: photoUserPrompt(target, sectionNames),
      imageDataUrl: image,
      maxTokens: 6000,
      timeoutMs: PHOTO_TIMEOUT_MS,
    });
  } catch (error) {
    if (error instanceof VisionError) {
      if (error.status === 429) return tooMany(error.retryAfterSec ?? 20, error.message);
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof Error && error.name === "AbortError") {
      return NextResponse.json({ error: "La IA tardó demasiado en leer la foto. Probá con una foto más chica o más nítida." }, { status: 504 });
    }
    console.error("AI photo import failed:", error);
    return NextResponse.json({ error: "No se pudo analizar la foto." }, { status: 502 });
  }
  const extraction = normalizePhotoExtraction(raw, target);
  if (!extraction || extraction.rows.length === 0) {
    const warnings = extraction?.warnings ?? [];
    return NextResponse.json({
      error: "No encontré filas legibles en la foto. Probá con más luz, de frente y con la planilla entera.",
      code: "ai_import_no_rows",
      warnings,
    }, { status: 422 });
  }
  return NextResponse.json({ mode: "photo", ...extraction });
}

export async function POST(req: NextRequest) {
  // Write access: the result only feeds an import, and viewers can't import.
  const result = await requireFarm({ write: true });
  if ("error" in result) return result.error;

  const limit = await checkRateLimit(`ai-import:${result.farmId}`, AI_IMPORT_RATE_LIMIT);
  if (!limit.allowed) return tooMany(limit.retryAfterSec);

  const parsed = await parseJsonBody(req, MAX_BODY_BYTES);
  if ("error" in parsed) return parsed.error;
  const { mode, target = "auto" } = parsed.data;
  if (!isRequestedImportTarget(target)) return NextResponse.json({ error: "Destino de importación inválido." }, { status: 400 });

  try {
    if (mode === "sheet") return await mapSheet(parsed.data.headers, parsed.data.rows, target);
    if (mode === "photo") return await readPhoto(result.farmId, parsed.data.image, target);
  } catch (error) {
    console.error("AI import failed:", error);
    return NextResponse.json({ error: "No se pudo completar el análisis con IA." }, { status: 500 });
  }
  return NextResponse.json({ error: "Modo de importación inválido." }, { status: 400 });
}
