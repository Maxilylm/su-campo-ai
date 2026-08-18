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
    )
    .slice(-AI_CONVERSATION_HISTORY_LIMIT)
    .map((row) => ({ role: row.role, content: row.content.slice(0, AI_CONVERSATION_MESSAGE_LIMIT) }));
}

export function persistedChatUserMessage(text: string, messageType: "text" | "audio"): string {
  return messageType === "audio" ? `🎤 ${text}` : text;
}
