export interface ChatMessageRecord {
  role: "user" | "assistant";
  text: string;
  failed?: boolean;
  retryText?: string;
}

export interface PreparedChatRequest {
  normalizedText: string;
  nextMessages: ChatMessageRecord[];
  history: ChatMessageRecord[];
}

export function prepareChatRequest(
  messages: ChatMessageRecord[],
  text: string,
  retrying = false,
): PreparedChatRequest {
  const normalizedText = text.trim();
  const last = messages[messages.length - 1];
  const previousUser = messages[messages.length - 2];
  const isRetryOfLastFailure = retrying
    && last?.failed
    && last.retryText === normalizedText
    && previousUser?.role === "user"
    && previousUser.text === normalizedText;
  const baseMessages = isRetryOfLastFailure
    ? messages.slice(0, -2)
    : messages.filter((message) => !message.failed);

  return {
    normalizedText,
    nextMessages: [...baseMessages, { role: "user", text: normalizedText }],
    history: baseMessages.slice(-20),
  };
}
