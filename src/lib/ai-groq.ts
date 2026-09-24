// Groq HTTP client: endpoint, retry-after parsing, request timeouts and the
// Whisper transcription call. The chat model itself is chosen in groq-model.ts.
import { env } from "./env";
import { fetchWithTimeout } from "./fetch";

export const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

/** Parse Groq's Retry-After (seconds, per OpenAI-compatible 429 responses)
 * with a sane fallback for when it's absent or malformed. */
export function groqRetryAfterSec(res: Response, fallbackSec = 20): number {
  const header = res.headers.get("retry-after");
  const parsed = header ? Number(header) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.ceil(parsed) : fallbackSec;
}
export const AI_CHAT_COMPLETION_TIMEOUT_MS = 15_000;
export const AI_SUMMARY_TIMEOUT_MS = 15_000;

/** POST an OpenAI-compatible chat completion body to Groq. */
export function postGroqChatCompletion(body: Record<string, unknown>, timeoutMs: number): Promise<Response> {
  return fetchWithTimeout(GROQ_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.groqApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  }, timeoutMs);
}

// Transcribe audio using Groq Whisper
export async function transcribeAudio(audioBuffer: Buffer, timeoutMs = 30000): Promise<string> {
  const formData = new FormData();
  formData.append(
    "file",
    new Blob([new Uint8Array(audioBuffer)], { type: "audio/ogg" }),
    "audio.ogg"
  );
  formData.append("model", "whisper-large-v3-turbo");
  formData.append("language", "es");

  const res = await fetchWithTimeout("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.groqApiKey}` },
    body: formData,
  }, timeoutMs);

  if (!res.ok) {
    const err = await res.text();
    console.error("Whisper error:", err);
    throw new Error("Audio transcription failed");
  }

  const data = await res.json();
  return data.text;
}
