// Groq vision helper: send one image plus an instruction and get JSON back.
// Shared by the photo importers (hacienda planillas, field maps).
import { env } from "./env";
import { postGroqChatCompletion } from "./ai-groq";

export const AI_VISION_TIMEOUT_MS = 30_000;
/** Groq rejects base64 images above ~4 MB; the client downsizes before upload. */
export const MAX_VISION_IMAGE_BYTES = 4 * 1024 * 1024;
const DATA_URL_RE = /^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/;

export class VisionError extends Error {
  constructor(message: string, readonly status: number, readonly retryAfterSec?: number) {
    super(message);
  }
}

/** True when `value` is a base64 image data URL small enough for the vision model. */
export function isAcceptableImageDataUrl(value: unknown): value is string {
  if (typeof value !== "string" || !DATA_URL_RE.test(value)) return false;
  const base64 = value.slice(value.indexOf(",") + 1);
  return Math.floor((base64.length * 3) / 4) <= MAX_VISION_IMAGE_BYTES;
}

/** Pull the first JSON object out of a model reply (tolerates ```json fences and prose). */
export function extractJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Ask the vision model about one image; resolves to the parsed JSON object it returns. */
export async function askVisionJson(options: {
  system: string;
  prompt: string;
  imageDataUrl: string;
  maxTokens?: number;
  timeoutMs?: number;
}): Promise<unknown> {
  const res = await postGroqChatCompletion({
    model: env.groqVisionModel,
    temperature: 0.1,
    max_tokens: options.maxTokens ?? 4096,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: options.system },
      {
        role: "user",
        content: [
          { type: "text", text: options.prompt },
          { type: "image_url", image_url: { url: options.imageDataUrl } },
        ],
      },
    ],
  }, options.timeoutMs ?? AI_VISION_TIMEOUT_MS);
  if (res.status === 429) {
    const retry = Number(res.headers.get("retry-after"));
    throw new VisionError("El servicio de IA está saturado. Probá en unos segundos.", 429, Number.isFinite(retry) && retry > 0 ? retry : 20);
  }
  if (!res.ok) {
    console.error("Groq vision error:", res.status, await res.text().catch(() => ""));
    throw new VisionError("No se pudo analizar la imagen.", 502);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  const parsed = typeof content === "string" ? extractJsonObject(content) : null;
  if (!parsed) throw new VisionError("La IA no devolvió un resultado legible. Probá con una foto más nítida.", 422);
  return parsed;
}
