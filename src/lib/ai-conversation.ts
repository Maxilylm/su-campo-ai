export const AI_CONVERSATION_HISTORY_LIMIT = 20;
const AI_CONVERSATION_MESSAGE_LIMIT = 4_000;

export interface ChatHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

/** Normalize persisted cross-channel messages before handing them to Groq. */
export function normalizeStoredChatHistory(rows: unknown): ChatHistoryMessage[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((row): row is { role: "user" | "assistant"; content: string } =>
      Boolean(row)
      && typeof row === "object"
      && (row as { role?: unknown }).role !== undefined
      && ((row as { role?: unknown }).role === "user" || (row as { role?: unknown }).role === "assistant")
      && typeof (row as { content?: unknown }).content === "string"
      && Boolean((row as { content: string }).content.trim())
    )
    .slice(-AI_CONVERSATION_HISTORY_LIMIT)
    .map((row) => ({ role: row.role, content: row.content.slice(0, AI_CONVERSATION_MESSAGE_LIMIT) }));
}


export function persistedChatUserMessage(text: string, messageType: "text" | "audio"): string {
  return messageType === "audio" ? `🎤 ${text}` : text;
}

const FAILED_REPLY = /^hubo un error procesando tu mensaje/i;

function normalizeQuestion(text: string): string {
  return text
    .replace(/^\[mensaje de audio transcripto\]:\s*/i, "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9ñ ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * History is for following the conversation, not a source of facts. Asked
 * the same question again, the model copied its earlier answer word for word
 * even after the farm context had changed (loop 11b: a move it had called
 * "más adelante" was now first in ESTA SEMANA). Earlier exchanges that asked
 * the same question are dropped so the answer comes from current context, and
 * failed exchanges ("Hubo un error…") are dropped as noise.
 */
export function pruneStaleHistory(history: ChatHistoryMessage[], currentMessage: string): ChatHistoryMessage[] {
  const current = normalizeQuestion(currentMessage);
  const out: ChatHistoryMessage[] = [];
  for (let i = 0; i < history.length; i += 1) {
    const turn = history[i];
    const reply = history[i + 1];
    if (turn.role === "user" && reply?.role === "assistant") {
      const failed = FAILED_REPLY.test(reply.content.trim());
      const repeated = current !== "" && normalizeQuestion(turn.content) === current;
      if (failed || repeated) {
        i += 1;
        continue;
      }
    }
    out.push(turn);
  }
  return out;
}
