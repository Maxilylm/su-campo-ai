import { describe, expect, it } from "vitest";
import { AI_CONVERSATION_HISTORY_LIMIT, normalizeClientChatHistory, normalizeStoredChatHistory, persistedChatUserMessage } from "./ai-conversation";

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

  it("normalizes text-shaped client history like persisted cross-channel history", () => {
    const history = normalizeClientChatHistory([
      { role: "user", text: "consulta" },
      { role: "assistant", text: "respuesta", failed: true },
      { role: "assistant", content: "respuesta válida" },
      { role: "system", text: "no debe entrar" },
      { role: "user", text: "   " },
    ]);
    expect(history).toEqual([
      { role: "user", content: "consulta" },
      { role: "assistant", content: "respuesta válida" },
    ]);
  });
});
