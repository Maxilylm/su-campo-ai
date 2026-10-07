import { NextRequest, NextResponse } from "next/server";
import { requireFarm } from "@/lib/auth";
import { parseJsonBody } from "@/lib/request";
import { checkRateLimit } from "@/lib/rate-limit";
import { askVisionJson, isAcceptableImageDataUrl, VisionError } from "@/lib/ai-vision";
import { MAP_PHOTO_PROMPT, MAP_PHOTO_SYSTEM, parseMapExtraction } from "@/lib/map-photo-import";

// Read a photo of the field's map ("plano del campo") into draft potreros,
// aguadas and lines. Nothing is written here: the client pins the photo on
// the map and the user confirms each shape, which then goes through the
// ordinary /api/padrones, /api/sections/geometry, /api/water-points and
// /api/map-features routes with their own validation.

export const maxDuration = 45;

const MAP_IMPORT_RATE_LIMIT = { capacity: 3, refillPerSec: 1 / 60 };
// The client downsizes to ~1600 px JPEG; Vercel rejects bodies above 4.5 MB.
const MAX_BODY_BYTES = 4_200_000;

export async function POST(req: NextRequest) {
  const result = await requireFarm({ write: true });
  if ("error" in result) return result.error;

  const limit = await checkRateLimit(`map-import:${result.farmId}`, MAP_IMPORT_RATE_LIMIT);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Ya analizaste varios planos seguidos. Esperá un minuto e intentá de nuevo." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
    );
  }

  const parsed = await parseJsonBody(req, MAX_BODY_BYTES);
  if ("error" in parsed) return parsed.error;
  const { image, width, height } = parsed.data;
  if (!isAcceptableImageDataUrl(image)) {
    return NextResponse.json({ error: "La imagen no es válida o es demasiado grande. Probá con una foto JPG o PNG." }, { status: 400 });
  }
  const size = Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 && width <= 10_000 && height <= 10_000
    ? { width: Number(width), height: Number(height) }
    : undefined;

  try {
    const raw = await askVisionJson({ system: MAP_PHOTO_SYSTEM, prompt: MAP_PHOTO_PROMPT, imageDataUrl: image, maxTokens: 6000 });
    const extraction = parseMapExtraction(raw, size);
    if (!extraction) return NextResponse.json({ error: "La IA no devolvió un plano legible. Probá con una foto más nítida." }, { status: 422 });
    if (extraction.potreros.length + extraction.aguadas.length + extraction.lines.length === 0) {
      return NextResponse.json({
        error: extraction.notes
          ? `No encontramos potreros, aguadas ni alambrados en la foto. ${extraction.notes}`
          : "No encontramos potreros, aguadas ni alambrados en la foto. Probá con una foto más de frente y con buena luz.",
      }, { status: 422 });
    }
    return NextResponse.json(extraction);
  } catch (error) {
    if (error instanceof VisionError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status, ...(error.retryAfterSec ? { headers: { "Retry-After": String(error.retryAfterSec) } } : {}) },
      );
    }
    if (error instanceof Error && error.name === "AbortError") {
      return NextResponse.json({ error: "El análisis del plano tardó demasiado. Probá con una foto más chica o más nítida." }, { status: 504 });
    }
    console.error("map import failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "No se pudo analizar el plano. Intentá nuevamente." }, { status: 502 });
  }
}
