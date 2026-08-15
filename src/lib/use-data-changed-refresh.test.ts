import { describe, expect, it, vi } from "vitest";
import { createRefreshScheduler, shouldRefreshAfterForeground } from "./use-data-changed-refresh";

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

  it("queues one refresh when a change arrives during an in-flight refresh", async () => {
    vi.useFakeTimers();
    let finishCurrent: (() => void) | null = null;
    const refresh = vi.fn(() => new Promise<void>((resolve) => { finishCurrent = resolve; }));
    const scheduler = createRefreshScheduler(refresh, 10);

    scheduler.schedule();
    vi.advanceTimersByTime(10);
    await Promise.resolve();
    expect(refresh).toHaveBeenCalledTimes(1);

    scheduler.schedule();
    vi.advanceTimersByTime(10);
    expect(refresh).toHaveBeenCalledTimes(1);

    finishCurrent?.();
    await vi.advanceTimersByTimeAsync(10);
    expect(refresh).toHaveBeenCalledTimes(2);

    scheduler.dispose();
    vi.useRealTimers();
  });
});
