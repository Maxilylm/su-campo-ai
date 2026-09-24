// Token budget for the farm context sent to Groq.
//
// Per-table row limits (AI_CONTEXT_LIMITS) bound each source, but not their
// sum: a large farm can still produce a context of tens of thousands of
// tokens, which is slow, costly against Groq's free-tier TPM limit, and
// dilutes the blocks that matter. This module caps the rendered context at a
// token budget and decides deterministically what to cut.
//
// Token estimate: ceil(chars / 4). That is the usual rule of thumb for
// English-like text with BPE tokenizers; Spanish and UUIDs tokenize somewhat
// worse, so the real count can run higher. It is only used to keep the
// context in the right order of magnitude, not to hit an exact limit, and the
// budget below leaves room for the system prompt (~2.5k tokens), history and
// max_tokens inside the model's context window.

export const AI_CONTEXT_TOKEN_BUDGET = 6_000;

/** Tokens kept free for the AVISO line that lists what was trimmed. */
const TRIM_NOTICE_RESERVE_TOKENS = 120;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Lower number = more decision-relevant = trimmed last. */
export const AI_CONTEXT_PRIORITY = {
  /** Never trimmed (totals). */
  pinned: 0,
  /** Deadlines (PENDIENTES) and stocking/rotation: what to do next. */
  critical: 1,
  /** Open tasks, health events, recent activity. */
  high: 2,
  /** Potreros with their lotes (ids for operations), vaccinations, on-demand blocks. */
  medium: 3,
  /** Crops, inventory, finance summary. */
  low: 4,
  /** Weight history. */
  lowest: 5,
} as const;

export interface AIContextBlock {
  /** Human label used in the trim notice, e.g. "pesajes". */
  label: string;
  priority: number;
  /** Rendered block; its first non-empty line is the header, the rest are rows. */
  text: string;
}

export interface BudgetedContext {
  text: string;
  /** Labels of blocks that lost rows (or were dropped), in trim order. */
  trimmed: string[];
}

/** Keep the blocks (in their original order) within `budgetTokens`, trimming
 * rows from the end of the least relevant block first. Ties go to the block
 * that appears later. A block reduced to its header is dropped entirely.
 * `preamble` (header and AVISO lines) and pinned blocks are never trimmed. */
export function fitContextToBudget(
  preamble: string,
  blocks: AIContextBlock[],
  budgetTokens = AI_CONTEXT_TOKEN_BUDGET,
): BudgetedContext {
  const full = preamble + blocks.map((block) => block.text).join("");
  if (estimateTokens(full) <= budgetTokens) return { text: full, trimmed: [] };

  const lines = blocks.map((block) => block.text.split("\n"));
  const maxChars = Math.max(0, budgetTokens - TRIM_NOTICE_RESERVE_TOKENS) * 4;
  const order = blocks
    .map((block, index) => ({ index, priority: block.priority }))
    .filter((entry) => entry.priority > AI_CONTEXT_PRIORITY.pinned)
    .sort((a, b) => b.priority - a.priority || b.index - a.index);
  const trimmed: string[] = [];
  let chars = full.length;

  for (const { index } of order) {
    if (chars <= maxChars) break;
    const blockLines = lines[index];
    const trailingNewline = blockLines.length > 1 && blockLines[blockLines.length - 1] === "";
    if (trailingNewline) blockLines.pop();
    const headerIndex = blockLines.findIndex((line) => line.trim() !== "");
    if (headerIndex === -1) {
      if (trailingNewline) blockLines.push("");
      continue;
    }
    while (chars > maxChars && blockLines.length > headerIndex + 1) {
      chars -= blockLines.pop()!.length + 1;
    }
    if (blockLines.length === headerIndex + 1) {
      // Only the header is left: drop it rather than show an empty list.
      chars -= blockLines.join("\n").length + (trailingNewline ? 1 : 0);
      lines[index] = [];
    } else if (trailingNewline) {
      blockLines.push("");
    }
    trimmed.push(blocks[index].label);
  }

  const body = lines.map((blockLines) => blockLines.join("\n")).join("");
  return { text: preamble + contextTrimNotice(trimmed) + body, trimmed };
}

/** Same wording family as the row-limit AVISO in getFarmContext, so the
 * system prompt's rule about incomplete sources covers it. */
export function contextTrimNotice(trimmed: string[]): string {
  if (trimmed.length === 0) return "";
  return `AVISO DE CONTEXTO: para no exceder el límite del modelo, estas partes del contexto se recortaron: ${trimmed.join(", ")}. No afirmes que el conjunto es completo, no inventes identificadores que no aparezcan aquí y pedí al usuario que abra el módulo correspondiente si necesita un registro no visible.\n\n`;
}
