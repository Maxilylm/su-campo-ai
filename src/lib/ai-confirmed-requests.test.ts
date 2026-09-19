import { describe, expect, it } from "vitest";
import { claimConfirmedProposal } from "./ai-confirmed-requests";

type InsertResult = { error: { code?: string; message?: string } | null };

function fakeDb(result: InsertResult | (() => InsertResult)) {
  return {
    from: () => ({
      insert: () => Promise.resolve(typeof result === "function" ? result() : result),
    }),
  } as never;
}

describe("claimConfirmedProposal", () => {
  it("claims a fresh requestId", async () => {
    const db = fakeDb({ error: null });
    await expect(claimConfirmedProposal(db, "farm-a", "req-1")).resolves.toBe("claimed");
  });

  it("reports a duplicate insert (23505) as already used", async () => {
    const db = fakeDb({ error: { code: "23505", message: "duplicate key" } });
    await expect(claimConfirmedProposal(db, "farm-a", "req-1")).resolves.toBe("already_used");
  });

  it("reports any other DB error as unavailable rather than silently allowing re-execution", async () => {
    const db = fakeDb({ error: { code: "42P01", message: "relation does not exist" } });
    await expect(claimConfirmedProposal(db, "farm-a", "req-1")).resolves.toBe("unavailable");
  });
});
