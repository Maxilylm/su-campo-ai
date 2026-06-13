// Robustly extract a JSON object from an LLM response.
// Models sometimes wrap JSON in ```json fences or add a sentence before/after,
// even when asked for raw JSON. This strips that noise and parses the first
// balanced {...} object. Returns null if nothing parseable is found.
export function extractJsonObject<T = unknown>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  let text = raw.trim();

  // Strip Markdown code fences: ```json ... ``` or ``` ... ```
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence) text = fence[1].trim();

  // Fast path: the whole thing is already valid JSON.
  try {
    return JSON.parse(text) as T;
  } catch {
    // fall through to brace-scanning
  }

  // Scan for the first balanced top-level object, ignoring braces inside strings.
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        const candidate = text.slice(start, i + 1);
        try {
          return JSON.parse(candidate) as T;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
