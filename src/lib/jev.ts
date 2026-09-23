import { env } from "./env";
import { fetchWithTimeout } from "./fetch";

const JEV_URL = "https://api.typesafe.ai/v1/systemone";
const JEV_MODEL = "jev-latest";

// Jev answers in 70-500ms (305-775ms measured end-to-end from this module).
// The budget has to stay well under what's left of the route's 30s
// maxDuration once the Groq completion (15s) and the operations budget (12s)
// have taken theirs — the WhatsApp webhook runs this synchronously before
// acking Meta, which retries on a slow 200. Failing fast here costs only the
// gate; overrunning costs the whole request.
export const JEV_TIMEOUT_MS = 1_500;

export type JevQuestion =
  | { type: "noul"; instructions: string; criteria: { true: string; false: string } }
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "score"; instructions: string; criteria: string[] };

export interface JevNoulAnswer {
  type: "noul";
  noul: number;
}

export interface JevChoiceAnswer {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

export interface JevScoreAnswer {
  type: "score";
  score: number;
  confidence: number;
  legend?: Record<string, string>;
  probabilities: Record<string, number>;
}

export type JevAnswer = JevNoulAnswer | JevChoiceAnswer | JevScoreAnswer;
export type JevAnswers = Record<string, JevAnswer>;

/**
 * Ask TypeSafe's System One model a set of typed questions about one state.
 *
 * Never throws and never returns a partial guess: every failure — no API key,
 * a rejected request, a timeout, a body we don't recognise — comes back as
 * null so callers fall back to whatever they did before the gate existed.
 * Answers are returned as the provider sent them; callers narrow each one by
 * type rather than trusting the shape.
 */
export async function askJev(
  state: string,
  questions: Record<string, JevQuestion>,
  timeoutMs = JEV_TIMEOUT_MS,
): Promise<JevAnswers | null> {
  const apiKey = env.typesafeApiKey;
  if (!apiKey) return null;

  try {
    const res = await fetchWithTimeout(JEV_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: JEV_MODEL, state, questions }),
    }, timeoutMs);

    if (!res.ok) {
      console.warn(`[CampoAI] Jev request failed with status ${res.status}`);
      return null;
    }

    const body: unknown = await res.json();
    const answers = (body as { answers?: unknown } | null)?.answers;
    if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
      console.warn("[CampoAI] Jev returned no answers object");
      return null;
    }
    return answers as JevAnswers;
  } catch (error) {
    console.warn("[CampoAI] Jev unavailable:", error);
    return null;
  }
}
