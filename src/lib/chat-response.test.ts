import { describe, expect, it } from "vitest";
import {
  assistantMessageFromResponse,
  chatFailureText,
  formatRecordingTime,
  historyToMessages,
  indexPendingConfirmations,
  pickChatLinks,
  responseHasPendingConfirmation,
} from "./chat-response";

describe("chat response mapping", () => {
  it("keeps only well-formed links", () => {
    expect(pickChatLinks(undefined)).toBeUndefined();
    expect(pickChatLinks([{ label: "Hacienda", href: "/produccion/hacienda" }, { label: 1, href: "/x" }, null]))
      .toEqual([{ label: "Hacienda", href: "/produccion/hacienda" }]);
  });

  it("indexes only complete pending confirmations", () => {
    const index = indexPendingConfirmations([
      { responseText: "Propuesta", token: "t", requestId: "r", expiresAt: 5, proposalRequestId: "p", affectedLinks: [{ label: "Sanidad", href: "/produccion/sanidad" }] },
      { responseText: "Incompleta", token: "t" },
    ]);
    expect([...index.keys()]).toEqual(["Propuesta"]);
    expect(index.get("Propuesta")?.affectedLinks).toEqual([{ label: "Sanidad", href: "/produccion/sanidad" }]);
    expect(indexPendingConfirmations("nope").size).toBe(0);
  });

  it("re-attaches an open proposal to its assistant message only", () => {
    const messages = historyToMessages(
      [{ role: "user", content: "Propuesta" }, { role: "assistant", content: "Propuesta" }],
      [{ responseText: "Propuesta", token: "t", requestId: "r", expiresAt: 5, proposalRequestId: "p", affectedLinks: [] }],
    );
    expect(messages[0]).toEqual({ role: "user", text: "Propuesta" });
    expect(messages[1]).toEqual({
      role: "assistant",
      text: "Propuesta",
      pendingConfirmationToken: "t",
      pendingConfirmationRequestId: "r",
      pendingConfirmationExpiresAt: 5,
      pendingConfirmationProposalRequestId: "p",
    });
  });

  it("builds the assistant message from a proposal response", () => {
    const data = {
      response: "Voy a registrar 20 vacas.",
      pendingConfirmationToken: "tok",
      pendingConfirmationRequestId: "req",
      pendingConfirmationExpiresAt: 99,
      pendingConfirmationLinks: [{ label: "Hacienda", href: "/produccion/hacienda" }],
    };
    expect(responseHasPendingConfirmation(data)).toBe(true);
    expect(assistantMessageFromResponse(data)).toEqual({
      role: "assistant",
      text: "Voy a registrar 20 vacas.",
      pendingConfirmationLinks: [{ label: "Hacienda", href: "/produccion/hacienda" }],
      pendingConfirmationToken: "tok",
      pendingConfirmationRequestId: "req",
      pendingConfirmationExpiresAt: 99,
    });
  });

  it("flags a pending migration as failed and falls back to a default text", () => {
    expect(assistantMessageFromResponse({ operationMigration: "20260101_x.sql" })).toEqual({
      role: "assistant",
      text: "Sin respuesta",
      failed: true,
      operationMigration: "20260101_x.sql",
    });
    expect(responseHasPendingConfirmation({ pendingConfirmationToken: "t" })).toBe(false);
  });

  it("hides transport errors behind a friendly message", () => {
    expect(chatFailureText(new Error("Failed to fetch"))).toBe("No pude conectar con CampoAI. Intentá nuevamente.");
    expect(chatFailureText(new Error("Límite alcanzado"))).toBe("Límite alcanzado");
    expect(chatFailureText("x")).toBe("No pude conectar con CampoAI. Intentá nuevamente.");
  });

  it("formats the recording timer", () => {
    expect(formatRecordingTime(0)).toBe("0:00");
    expect(formatRecordingTime(75)).toBe("1:15");
  });
});
