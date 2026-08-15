import { describe, expect, it } from "vitest";
import { allSettledWithConcurrency, extractFarmFromSyncResponse } from "./offline-sync";

describe("offline sync response helpers", () => {
  it("extracts the farm from the raw farm endpoint payload", () => {
    const farm = { id: "farm-1", name: "La Gloria" };
    expect(extractFarmFromSyncResponse({ farm, user: { id: "user-1" } })).toEqual(farm);
  });

  it("does not mistake a wrapped endpoint result for the farm payload", () => {
    expect(extractFarmFromSyncResponse({ data: { farm: { id: "farm-1" } } })).toBeNull();
    expect(extractFarmFromSyncResponse(null)).toBeNull();
  });

  it("limits concurrent requests while preserving result order and failures", async () => {
    let active = 0;
    let maximumActive = 0;
    const progress: Array<{ completed: number; total: number }> = [];
    const tasks = [0, 1, 2, 3, 4].map((value) => async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      if (value === 3) throw new Error("request failed");
      return value;
    });

    const results = await allSettledWithConcurrency(tasks, 2, (completed, total) => progress.push({ completed, total }));

    expect(maximumActive).toBeLessThanOrEqual(2);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled", "fulfilled", "rejected", "fulfilled"]);
    expect(results[0]).toEqual({ status: "fulfilled", value: 0 });
    expect(results[4]).toEqual({ status: "fulfilled", value: 4 });
    expect(progress).toHaveLength(5);
    expect(progress.map((entry) => entry.completed)).toEqual([1, 2, 3, 4, 5]);
    expect(progress.every((entry) => entry.total === 5)).toBe(true);
  });
});
