import { describe, expect, it, vi } from "vitest";
import { withTimeout } from "./timeout";

describe("withTimeout", () => {
  it("returns the operation result before the deadline", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 100, "fallback")).resolves.toBe("ok");
  });

  it("clears the deadline after the operation settles", async () => {
    vi.useFakeTimers();
    try {
      await expect(withTimeout(Promise.resolve("ok"), 2500, "fallback")).resolves.toBe("ok");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns the fallback when the dependency is slow", async () => {
    vi.useFakeTimers();
    try {
      const pending = withTimeout(new Promise<string>(() => {}), 2500, "unavailable");
      await vi.advanceTimersByTimeAsync(2500);
      await expect(pending).resolves.toBe("unavailable");
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves dependency errors before the deadline", async () => {
    await expect(withTimeout(Promise.reject(new Error("down")), 100, "fallback")).rejects.toThrow("down");
  });
});
