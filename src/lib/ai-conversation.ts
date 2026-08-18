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

/** Normalize the text-shaped history sent by Web Chat and audio Chat. */
export function normalizeClientChatHistory(rows: unknown): ChatHistoryMessage[] {
  if (!Array.isArray(rows)) return [];
  return normalizeStoredChatHistory(rows
    .filter((row) => Boolean(row) && typeof row === "object" && !(row as { failed?: unknown }).failed)
    .map((row) => {
      if (!row || typeof row !== "object") return row;
      const candidate = row as { role?: unknown; text?: unknown; content?: unknown };
      return {
        role: candidate.role,
        content: typeof candidate.text === "string" ? candidate.text : candidate.content,
      };
    }));
}

export function persistedChatUserMessage(text: string, messageType: "text" | "audio"): string {
  return messageType === "audio" ? `🎤 ${text}` : text;
}
