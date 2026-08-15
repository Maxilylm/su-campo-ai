import { describe, expect, it } from "vitest";
import { normalizeChatRequestId } from "./chat-idempotency";

describe("normalizeChatRequestId", () => {
  it("accepts stable browser request keys", () => {
    expect(normalizeChatRequestId("8f1e4e7e-0f4e-4a96-a5b1-4c3c4c7bcb4c")).toBe("8f1e4e7e-0f4e-4a96-a5b1-4c3c4c7bcb4c");
  });

  it("rejects malformed or oversized keys", () => {
    expect(normalizeChatRequestId("short")).toBeNull();
    expect(normalizeChatRequestId("bad key with spaces")).toBeNull();
    expect(normalizeChatRequestId("a".repeat(101))).toBeNull();
  });
});
