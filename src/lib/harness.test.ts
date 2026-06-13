import { describe, it, expect } from "vitest";

// Sanity check that the test harness itself runs. Real unit tests live alongside
// the modules they cover (json.test.ts, ai.test.ts, env.test.ts).
describe("test harness", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
