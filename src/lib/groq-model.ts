import { env } from "./env";
/** gpt-oss models reason before answering, and those hidden tokens count
 * against max_tokens; "low" keeps replies fast and leaves the budget for the
 * answer. Other models reject the parameter, so it is sent only to gpt-oss. */
export function groqChatModelParams(model = env.groqChatModel): { model: string; reasoning_effort?: "low" } {
  return model.startsWith("openai/gpt-oss") ? { model, reasoning_effort: "low" } : { model };
}

export type GroqModelProbe = "ok" | "model_unavailable" | "auth_failed" | "timeout" | "unreachable";

/** Classify Groq's answer to GET /models/{id}. Free — no tokens are spent. */
export function classifyGroqModelResponse(status: number): GroqModelProbe {
  if (status >= 200 && status < 300) return "ok";
  if (status === 404) return "model_unavailable";
  if (status === 401 || status === 403) return "auth_failed";
  return "unreachable";
}

/** Only a retired model or a rejected key means the assistant is down; a
 * slow or unreachable Groq is transient and must not mark the app degraded. */
export function groqProbeHealthy(probe: GroqModelProbe): boolean {
  return probe !== "model_unavailable" && probe !== "auth_failed";
}

const PROBE_CACHE_MS = 5 * 60_000;
let cachedProbe: { model: string; probe: GroqModelProbe; at: number } | null = null;

/** Ask Groq whether the configured chat model still exists. A retired model
 * once took the assistant down for days while health checks said "ok",
 * because they only verified that a key was set. */
export async function probeGroqModel(apiKey: string, model = env.groqChatModel, timeoutMs = 3000): Promise<GroqModelProbe> {
  if (cachedProbe && cachedProbe.model === model && Date.now() - cachedProbe.at < PROBE_CACHE_MS) return cachedProbe.probe;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let probe: GroqModelProbe;
  try {
    const res = await fetch(`https://api.groq.com/openai/v1/models/${encodeURIComponent(model)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
      signal: controller.signal,
    });
    probe = classifyGroqModelResponse(res.status);
  } catch {
    probe = controller.signal.aborted ? "timeout" : "unreachable";
  } finally {
    clearTimeout(timer);
  }
  // Transient failures are retried on the next check rather than cached.
  if (probe === "ok" || probe === "model_unavailable" || probe === "auth_failed") cachedProbe = { model, probe, at: Date.now() };
  return probe;
}
