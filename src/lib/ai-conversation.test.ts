import { describe, expect, it } from "vitest";
import { AI_CONVERSATION_HISTORY_LIMIT, normalizeStoredChatHistory, persistedChatUserMessage } from "./ai-conversation";

describe("AI conversation sharing", () => {
  it("keeps only valid, bounded messages for cross-channel context", () => {
    const rows = [
      { role: "system", content: "ignore" },
      ...Array.from({ length: AI_CONVERSATION_HISTORY_LIMIT + 2 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", content: `message-${index}` })),
    ];
    expect(normalizeStoredChatHistory(rows)).toHaveLength(AI_CONVERSATION_HISTORY_LIMIT);
    expect(normalizeStoredChatHistory(rows)[0]?.content).toBe("message-2");
    expect(normalizeStoredChatHistory([{ role: "user", content: "x".repeat(5000) }])[0]?.content).toHaveLength(4000);
  });

  it("preserves the source of audio messages in the shared transcript", () => {
    expect(persistedChatUserMessage("mové diez terneros", "audio")).toBe("🎤 mové diez terneros");
    expect(persistedChatUserMessage("¿cuántas cabezas hay?", "text")).toBe("¿cuántas cabezas hay?");
  });
});
