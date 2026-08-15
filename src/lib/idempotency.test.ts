import { describe, expect, it } from "vitest";
import { parseIdempotencyKey } from "./idempotency";

describe("parseIdempotencyKey", () => {
  it("accepts a bounded retry key", () => {
    expect(parseIdempotencyKey("  purchase-attempt-1 ")).toBe("purchase-attempt-1");
  });

  it("treats a missing key as optional", () => {
    expect(parseIdempotencyKey(null)).toBeNull();
    expect(parseIdempotencyKey("   ")).toBeNull();
  });

  it("rejects malformed or oversized keys", () => {
    expect(parseIdempotencyKey("short")).toBe(false);
    expect(parseIdempotencyKey("bad key 123456")).toBe(false);
    expect(parseIdempotencyKey("a".repeat(129))).toBe(false);
  });
});
