import { describe, expect, it } from "vitest";
import {
  CONVERSATION_TITLE_MAX_CHARS,
  DEFAULT_CONVERSATION_TITLE,
  conversationHref,
  conversationTitleFromMessage,
  groupConversationsByDate,
  mergeFirstPage,
  normalizeConversationId,
  upsertConversation,
  normalizeConversationTitle,
} from "./chat-conversations";

describe("conversationTitleFromMessage", () => {
  it("keeps a short first message as is, trimmed and on one line", () => {
    expect(conversationTitleFromMessage("  ¿Cuántos novillos hay   en el Bajo? ")).toBe("¿Cuántos novillos hay en el Bajo?");
  });

  it("cuts a long message at a word boundary and marks the cut", () => {
    const text = "Revisá conmigo el plan de pastoreo de la semana y decime qué potreros conviene cerrar primero";
    const title = conversationTitleFromMessage(text);
    expect(title.length).toBeLessThanOrEqual(CONVERSATION_TITLE_MAX_CHARS + 1);
    expect(title.endsWith("…")).toBe(true);
    const words = title.slice(0, -1).split(" ");
    for (const word of words) expect(text.split(" ")).toContain(word);
    expect(title).toBe("Revisá conmigo el plan de pastoreo de la semana y decime qué…");
  });

  it("uses only the first non-empty line (handoff prompts are multi-line)", () => {
    expect(conversationTitleFromMessage("\n\nRevisá conmigo estos pendientes de alertas.\nUsá el estado actual…")).toBe("Revisá conmigo estos pendientes de alertas.");
  });

  it("drops the audio marker and trailing separators before the ellipsis", () => {
    expect(conversationTitleFromMessage("🎤 mové diez terneros al potrero norte")).toBe("mové diez terneros al potrero norte");
    const title = conversationTitleFromMessage(`${"palabra ".repeat(6)}final, ${"x".repeat(80)}`);
    expect(title).toBe("palabra palabra palabra palabra palabra palabra final…");
  });

  it("hard-cuts a single very long word", () => {
    const title = conversationTitleFromMessage("a".repeat(200));
    expect(title).toBe(`${"a".repeat(CONVERSATION_TITLE_MAX_CHARS)}…`);
  });

  it("falls back to the default title for empty input", () => {
    expect(conversationTitleFromMessage("   \n  ")).toBe(DEFAULT_CONVERSATION_TITLE);
    expect(conversationTitleFromMessage("🎤 ")).toBe(DEFAULT_CONVERSATION_TITLE);
  });
});

describe("normalizeConversationTitle", () => {
  it("accepts a trimmed, single-line title up to 120 characters", () => {
    expect(normalizeConversationTitle("  Plan   de\npastoreo ")).toBe("Plan de pastoreo");
    expect(normalizeConversationTitle("x".repeat(120))).toHaveLength(120);
  });

  it("rejects blank, too long or non-string titles", () => {
    expect(normalizeConversationTitle("   ")).toBeNull();
    expect(normalizeConversationTitle("x".repeat(121))).toBeNull();
    expect(normalizeConversationTitle(42)).toBeNull();
  });
});

describe("normalizeConversationId", () => {
  it("accepts UUIDs only", () => {
    expect(normalizeConversationId("3F2504E0-4F89-41D3-9A0C-0305E82C3301")).toBe("3f2504e0-4f89-41d3-9a0c-0305e82c3301");
    expect(normalizeConversationId("not-a-uuid")).toBeNull();
    expect(normalizeConversationId(null)).toBeNull();
    expect(normalizeConversationId("")).toBeNull();
  });
});

describe("conversationHref", () => {
  it("puts the active conversation in the URL and keeps other params", () => {
    expect(conversationHref("/chat", "", "abc")).toBe("/chat?c=abc");
    expect(conversationHref("/chat", "?c=old&x=1", "new")).toBe("/chat?c=new&x=1");
    expect(conversationHref("/chat", "?c=old", null)).toBe("/chat");
  });
});

describe("upsertConversation / mergeFirstPage", () => {
  const c = (id: string, updatedAt = "2026-09-24T12:00:00Z") => ({ id, updated_at: updatedAt });

  it("moves a used conversation to the top without duplicating it", () => {
    expect(upsertConversation([c("a"), c("b"), c("c")], c("c")).map((item) => item.id)).toEqual(["c", "a", "b"]);
    expect(upsertConversation([c("a")], c("new")).map((item) => item.id)).toEqual(["new", "a"]);
  });

  it("keeps older paged-in items below a refreshed first page", () => {
    const existing = [c("a", "2026-09-24T10:00:00Z"), c("b", "2026-09-23T10:00:00Z"), c("old", "2026-09-01T10:00:00Z")];
    const fresh = [c("new", "2026-09-24T11:00:00Z"), c("a", "2026-09-24T10:00:00Z")];
    expect(mergeFirstPage(existing, fresh, true).map((item) => item.id)).toEqual(["new", "a", "b", "old"]);
    // Without more pages, the fresh page is the whole list (deleted items drop out).
    expect(mergeFirstPage(existing, fresh, false).map((item) => item.id)).toEqual(["new", "a"]);
  });
});

describe("groupConversationsByDate", () => {
  // 2026-09-24 10:00 in Montevideo (UTC-3).
  const now = Date.parse("2026-09-24T13:00:00Z");
  const item = (id: string, updatedAt: string) => ({ id, updated_at: updatedAt });

  it("groups by farm-local calendar day, in list order, skipping empty groups", () => {
    const groups = groupConversationsByDate([
      item("today", "2026-09-24T12:00:00Z"),
      // 23:30 of the 23rd in Montevideo, already the 24th in UTC.
      item("late-yesterday", "2026-09-24T02:30:00Z"),
      item("week", "2026-09-18T15:00:00Z"),
      item("edge-week", "2026-09-17T15:00:00Z"),
      item("older", "2026-09-16T15:00:00Z"),
    ], now);
    expect(groups.map((group) => [group.label, group.items.map((entry) => entry.id)])).toEqual([
      ["Hoy", ["today"]],
      ["Ayer", ["late-yesterday"]],
      ["Últimos 7 días", ["week", "edge-week"]],
      ["Anteriores", ["older"]],
    ]);
  });

  it("treats future and unparseable dates safely", () => {
    const groups = groupConversationsByDate([
      item("future", "2026-09-25T12:00:00Z"),
      item("broken", "not a date"),
    ], now);
    expect(groups.map((group) => [group.key, group.items.map((entry) => entry.id)])).toEqual([
      ["today", ["future"]],
      ["older", ["broken"]],
    ]);
  });

  it("returns no groups for an empty list", () => {
    expect(groupConversationsByDate([], now)).toEqual([]);
  });
});
