import { describe, expect, it } from "vitest";
import { prepareChatRequest } from "./chat";

describe("chat request preparation", () => {
  it("removes the failed turn before retrying it", () => {
    const result = prepareChatRequest([
      { role: "user", text: "¿Cuántas vacas hay?" },
      { role: "assistant", text: "No pude conectar", failed: true, retryText: "¿Cuántas vacas hay?" },
    ], " ¿Cuántas vacas hay? ", true);

    expect(result.normalizedText).toBe("¿Cuántas vacas hay?");
    expect(result.nextMessages).toEqual([{ role: "user", text: "¿Cuántas vacas hay?" }]);
    expect(result.history).toEqual([]);
  });

  it("keeps useful history while excluding failed responses", () => {
    const result = prepareChatRequest([
      { role: "user", text: "Mensaje anterior" },
      { role: "assistant", text: "Respuesta anterior" },
      { role: "assistant", text: "Error de conexión", failed: true, retryText: "Nuevo mensaje" },
    ], "Nuevo mensaje");

    expect(result.history).toEqual([
      { role: "user", text: "Mensaje anterior" },
      { role: "assistant", text: "Respuesta anterior" },
    ]);
  });

  it("limits the model context to the latest twenty messages", () => {
    const messages = Array.from({ length: 24 }, (_, index) => ({ role: "user" as const, text: `Mensaje ${index}` }));
    const result = prepareChatRequest(messages, "Último");

    expect(result.history).toHaveLength(20);
    expect(result.history[0].text).toBe("Mensaje 4");
  });
});
