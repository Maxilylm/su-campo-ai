import { describe, expect, it } from "vitest";
import { mergeFinancialContext } from "./finance-navigation";

describe("mergeFinancialContext", () => {
  it("keeps recent records and adds an older exact record as context", () => {
    const result = mergeFinancialContext(
      [{ id: "recent", date: "2026-08-14" }],
      [{ id: "old", date: "2025-01-10" }],
      "old",
    );

    expect(result).toEqual([
      { id: "recent", date: "2026-08-14" },
      { id: "old", date: "2025-01-10", contextOnly: true },
    ]);
  });

  it("does not duplicate an exact record already in the period", () => {
    const result = mergeFinancialContext(
      [{ id: "same", date: "2026-08-14" }],
      [{ id: "same", date: "2026-08-14" }],
      "same",
    );

    expect(result).toEqual([{ id: "same", date: "2026-08-14" }]);
  });

  it("returns the period unchanged without a requested record", () => {
    const recent = [{ id: "recent", date: "2026-08-14" }];
    expect(mergeFinancialContext(recent, [{ id: "old", date: "2025-01-10" }], null)).toBe(recent);
  });
});
