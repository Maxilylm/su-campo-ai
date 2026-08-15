import { describe, expect, it } from "vitest";
import { createSingleFlight } from "./single-flight";

describe("createSingleFlight", () => {
  it("shares concurrent work and refreshes after it settles", async () => {
    const singleFlight = createSingleFlight<number>();
    let calls = 0;
    let resolveFirst: (value: number) => void = () => {};
    const first = singleFlight(() => {
      calls += 1;
      return new Promise<number>((resolve) => { resolveFirst = resolve; });
    });
    const second = singleFlight(async () => {
      calls += 1;
      return 7;
    });

    expect(second).toBe(first);
    expect(calls).toBe(1);
    resolveFirst(42);
    await expect(first).resolves.toBe(42);

    await expect(singleFlight(async () => {
      calls += 1;
      return 7;
    })).resolves.toBe(7);
    expect(calls).toBe(2);
  });
});
