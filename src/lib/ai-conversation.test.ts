import { describe, expect, it } from "vitest";
import { AI_CONVERSATION_HISTORY_LIMIT, normalizeStoredChatHistory, persistedChatUserMessage, pruneStaleHistory } from "./ai-conversation";

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

describe("pruneStaleHistory", () => {
  const history = [
    { role: "user" as const, content: "Registrar 20 vacas Angus en Norte" },
    { role: "assistant" as const, content: "Hubo un error procesando tu mensaje. Intentá de nuevo." },
    { role: "user" as const, content: "¿Hay que mover hacienda esta semana?" },
    { role: "assistant" as const, content: "No, está en más adelante." },
    { role: "user" as const, content: "¿Qué tengo que hacer esta semana?" },
    { role: "assistant" as const, content: "Tareas…" },
  ];

  it("drops earlier answers to the same question and failed exchanges", () => {
    expect(pruneStaleHistory(history, "¿hay que mover HACIENDA esta semana")).toEqual([
      { role: "user", content: "¿Qué tengo que hacer esta semana?" },
      { role: "assistant", content: "Tareas…" },
    ]);
  });

  it("keeps everything relevant for a new question, minus failures", () => {
    expect(pruneStaleHistory(history, "¿Y cuánto pesan los novillos?")).toHaveLength(4);
  });

  it("treats a transcribed audio question like the typed one", () => {
    const audio = [
      { role: "user" as const, content: "[Mensaje de audio transcripto]: qué tengo que hacer esta semana" },
      { role: "assistant" as const, content: "Old answer" },
    ];
    expect(pruneStaleHistory(audio, "¿Qué tengo que hacer esta semana?")).toEqual([]);
  });
});
