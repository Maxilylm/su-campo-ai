import { describe, expect, it } from "vitest";
import { shouldRefreshAfterForeground } from "./use-data-changed-refresh";

describe("foreground refresh guard", () => {
  it("waits until the minimum interval has elapsed", () => {
    expect(shouldRefreshAfterForeground(1000, 59_000, 60_000)).toBe(false);
    expect(shouldRefreshAfterForeground(1000, 61_000, 60_000)).toBe(true);
  });

  it("refreshes when there is no previous timestamp", () => {
    expect(shouldRefreshAfterForeground(Number.NaN, 1000, 60_000)).toBe(true);
  });

  it("allows a shorter recovery interval when the connection was unhealthy", () => {
    expect(shouldRefreshAfterForeground(1000, 16_000, 15_000)).toBe(true);
  });
});
