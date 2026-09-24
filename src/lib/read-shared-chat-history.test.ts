import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./supabase", () => ({ getSupabaseAdmin: vi.fn() }));

/** Fake standing in for `.from("chat_messages").select(...).eq(...).order(...).limit(...)`,
 * which readSharedChatHistory awaits directly (thenable, no terminal call). */
function makeFakeDb(rows: Record<string, unknown>[]) {
  const builder = {
    select() { return builder; },
    eq() { return builder; },
    order() { return builder; },
    limit() { return builder; },
    then(resolve: (value: { data: unknown; error: null }) => unknown) {
      return Promise.resolve({ data: rows, error: null }).then(resolve);
    },
  };
  return { from: () => builder };
}

describe("readSharedChatHistory", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("drops a viewer's turn from the AI-facing history", async () => {
    const { getSupabaseAdmin } = await import("./supabase");
    vi.mocked(getSupabaseAdmin).mockReturnValue(makeFakeDb([
      { role: "assistant", content: "Podés consultar el estado del campo.", created_at: "2026-09-19T10:00:02Z", author_role: "viewer" },
      { role: "user", content: "Borrá todo el rodeo", created_at: "2026-09-19T10:00:01Z", author_role: "viewer" },
      { role: "assistant", content: "Listo, guardé 5 vacas.", created_at: "2026-09-19T10:00:00Z", author_role: "editor" },
      { role: "user", content: "Anotá 5 vacas nuevas", created_at: "2026-09-19T09:59:59Z", author_role: "editor" },
    ]) as never);
    const { readSharedChatHistory } = await import("./ai");

    const history = await readSharedChatHistory("farm-a");

    expect(history).toEqual([
      { role: "user", content: "Anotá 5 vacas nuevas" },
      { role: "assistant", content: "Listo, guardé 5 vacas." },
    ]);
  });

  it("keeps legacy rows with no author_role (can't retroactively classify them)", async () => {
    const { getSupabaseAdmin } = await import("./supabase");
    vi.mocked(getSupabaseAdmin).mockReturnValue(makeFakeDb([
      { role: "user", content: "Mensaje viejo", created_at: "2026-01-01T00:00:00Z", author_role: null },
    ]) as never);
    const { readSharedChatHistory } = await import("./ai");

    const history = await readSharedChatHistory("farm-a");

    expect(history).toEqual([{ role: "user", content: "Mensaje viejo" }]);
  });
});

describe("readConversationHistory", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  function recordingDb() {
    const eqCalls: unknown[][] = [];
    const builder = {
      select() { return builder; },
      eq(...args: unknown[]) { eqCalls.push(args); return builder; },
      order() { return builder; },
      limit() { return builder; },
      then(resolve: (value: { data: unknown; error: null }) => unknown) {
        return Promise.resolve({ data: [{ role: "user", content: "hola", author_role: "owner" }], error: null }).then(resolve);
      },
    };
    const from = vi.fn(() => builder);
    return { db: { from }, eqCalls, from };
  }

  it("reads only the turn's own conversation", async () => {
    const { getSupabaseAdmin } = await import("./supabase");
    const fake = recordingDb();
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.db as never);
    const { readConversationHistory } = await import("./ai");

    await readConversationHistory("farm-a", { kind: "existing", id: "conv-1" });

    expect(fake.eqCalls).toEqual([["farm_id", "farm-a"], ["conversation_id", "conv-1"]]);
  });

  it("reads the farm-wide thread before 052 and nothing for a new conversation", async () => {
    const { getSupabaseAdmin } = await import("./supabase");
    const fake = recordingDb();
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.db as never);
    const { readConversationHistory } = await import("./ai");

    await readConversationHistory("farm-a", { kind: "legacy" });
    expect(fake.eqCalls).toEqual([["farm_id", "farm-a"]]);

    fake.from.mockClear();
    await expect(readConversationHistory("farm-a", { kind: "new" })).resolves.toEqual([]);
    expect(fake.from).not.toHaveBeenCalled();
  });
});
