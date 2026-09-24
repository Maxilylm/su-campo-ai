import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ensureWhatsAppConversation,
  isMissingConversationSchema,
  persistChatTurn,
  resolveConversationTarget,
} from "./chat-conversations-server";

type Call = { table: string; method: string; args: unknown[] };
type Result = { data?: unknown; error?: { code?: string; message?: string } | null };

/** A chainable stand-in for the Supabase query builder: each awaited query
 * resolves to the next queued result and records every method call. */
function fakeDb(results: Result[]) {
  const calls: Call[] = [];
  const queue = [...results];
  const db = {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      const chain = new Proxy(builder, {
        get(_target, prop: string) {
          if (prop === "then") {
            const next = queue.shift() ?? { data: null, error: null };
            return (resolve: (value: Result) => void) => resolve({ data: next.data ?? null, error: next.error ?? null });
          }
          return (...args: unknown[]) => {
            calls.push({ table, method: prop, args });
            return chain;
          };
        },
      });
      return chain;
    },
  };
  return { db: db as unknown as SupabaseClient, calls };
}

const FARM = "11111111-1111-4111-8111-111111111111";
const CONV = "22222222-2222-4222-8222-222222222222";

describe("isMissingConversationSchema", () => {
  it("recognizes a missing table or column, not other errors", () => {
    expect(isMissingConversationSchema({ code: "42P01" })).toBe(true);
    expect(isMissingConversationSchema({ code: "PGRST205" })).toBe(true);
    expect(isMissingConversationSchema({ code: "PGRST204", message: "Could not find the 'conversation_id' column" })).toBe(true);
    expect(isMissingConversationSchema({ message: "relation \"public.chat_conversations\" does not exist" })).toBe(true);
    expect(isMissingConversationSchema({ code: "57014", message: "canceling statement due to statement timeout" })).toBe(false);
    expect(isMissingConversationSchema(null)).toBe(false);
  });
});

describe("resolveConversationTarget", () => {
  it("validates a requested conversation against the farm", async () => {
    const { db, calls } = fakeDb([{ data: { id: CONV } }]);
    await expect(resolveConversationTarget(db, FARM, { present: true, id: CONV })).resolves.toEqual({ kind: "existing", id: CONV });
    expect(calls).toContainEqual({ table: "chat_conversations", method: "eq", args: ["farm_id", FARM] });
    expect(calls).toContainEqual({ table: "chat_conversations", method: "eq", args: ["id", CONV] });
  });

  it("reports another farm's (or a malformed) id as not found", async () => {
    const { db } = fakeDb([{ data: null }]);
    await expect(resolveConversationTarget(db, FARM, { present: true, id: CONV })).resolves.toEqual({ kind: "not_found" });
    const { db: untouched, calls } = fakeDb([]);
    await expect(resolveConversationTarget(untouched, FARM, { present: true, id: "../etc" })).resolves.toEqual({ kind: "not_found" });
    expect(calls).toHaveLength(0);
  });

  it("starts a new conversation when the client sends null", async () => {
    const { db } = fakeDb([{ data: [{ id: CONV }] }]);
    await expect(resolveConversationTarget(db, FARM, { present: true, id: null })).resolves.toEqual({ kind: "new" });
  });

  it("continues the latest web conversation for a client that predates conversations", async () => {
    const { db, calls } = fakeDb([{ data: [{ id: CONV }] }]);
    await expect(resolveConversationTarget(db, FARM, { present: false, id: undefined })).resolves.toEqual({ kind: "existing", id: CONV });
    expect(calls).toContainEqual({ table: "chat_conversations", method: "eq", args: ["channel", "web"] });
  });

  it("falls back to the shared thread when 052 is not applied", async () => {
    const { db } = fakeDb([{ error: { code: "42P01", message: "relation does not exist" } }]);
    await expect(resolveConversationTarget(db, FARM, { present: true, id: null })).resolves.toEqual({ kind: "legacy" });
    const { db: other } = fakeDb([{ error: { code: "PGRST205" } }]);
    await expect(resolveConversationTarget(other, FARM, { present: true, id: CONV })).resolves.toEqual({ kind: "legacy" });
  });

  it("is unavailable on other database errors", async () => {
    const { db } = fakeDb([{ error: { code: "57014", message: "timeout" } }]);
    await expect(resolveConversationTarget(db, FARM, { present: true, id: CONV })).resolves.toEqual({ kind: "unavailable" });
  });
});

describe("persistChatTurn", () => {
  const base = { farmId: FARM, userId: "user-1", authorRole: "owner", userContent: "¿Cuántos novillos hay en el Bajo?", assistantContent: "Hay 40.", timeoutMs: 1000 };

  it("creates a new conversation titled from the message and saves both rows in it", async () => {
    const { db, calls } = fakeDb([
      { data: { id: CONV, title: "¿Cuántos novillos hay en el Bajo?", channel: "web", created_by: "user-1", created_at: "x", updated_at: "x" } },
      { data: null },
    ]);
    const result = await persistChatTurn(db, { ...base, target: { kind: "new" } });
    expect(result).toEqual({ ok: true, conversationId: CONV, conversationTitle: "¿Cuántos novillos hay en el Bajo?" });
    const created = calls.find((call) => call.table === "chat_conversations" && call.method === "insert");
    expect(created?.args[0]).toMatchObject({ farm_id: FARM, created_by: "user-1", title: "¿Cuántos novillos hay en el Bajo?", channel: "web" });
    const rows = calls.find((call) => call.table === "chat_messages" && call.method === "insert")?.args[0] as Array<Record<string, unknown>>;
    expect(rows.map((row) => row.conversation_id)).toEqual([CONV, CONV]);
    expect(rows.map((row) => row.farm_id)).toEqual([FARM, FARM]);
  });

  it("writes legacy rows without conversation_id when 052 is missing", async () => {
    const { db, calls } = fakeDb([{ data: null }]);
    const result = await persistChatTurn(db, { ...base, target: { kind: "legacy" } });
    expect(result).toEqual({ ok: true, conversationId: null });
    const rows = calls.find((call) => call.method === "insert")?.args[0] as Array<Record<string, unknown>>;
    expect(rows.every((row) => !("conversation_id" in row))).toBe(true);
  });

  it("reports the conversation it created when saving the messages fails", async () => {
    const { db } = fakeDb([
      { data: { id: CONV, title: "t", channel: "web", created_by: null, created_at: "x", updated_at: "x" } },
      { error: { code: "XX000", message: "boom" } },
    ]);
    await expect(persistChatTurn(db, { ...base, target: { kind: "new" } })).resolves.toEqual({ ok: false, reason: "error", conversationId: CONV });
  });
});

describe("ensureWhatsAppConversation", () => {
  it("reuses the farm's WhatsApp conversation", async () => {
    const { db, calls } = fakeDb([{ data: { id: CONV } }]);
    await expect(ensureWhatsAppConversation(db, FARM, 1000)).resolves.toEqual({ kind: "existing", id: CONV });
    expect(calls.some((call) => call.method === "insert")).toBe(false);
  });

  it("creates it on first use, and re-reads after a concurrent create", async () => {
    const { db } = fakeDb([{ data: null }, { data: { id: CONV } }]);
    await expect(ensureWhatsAppConversation(db, FARM, 1000)).resolves.toEqual({ kind: "existing", id: CONV });
    const { db: raced } = fakeDb([{ data: null }, { error: { code: "23505" } }, { data: { id: CONV } }]);
    await expect(ensureWhatsAppConversation(raced, FARM, 1000)).resolves.toEqual({ kind: "existing", id: CONV });
  });
});
