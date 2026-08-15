import { describe, expect, it } from "vitest";
import { isActiveSampleDataRequest } from "./sample-data-retry";

describe("sample data retry state", () => {
  it("keeps a recent seed claim active and releases stale claims", () => {
    const now = Date.parse("2026-08-15T12:00:00.000Z");
    expect(isActiveSampleDataRequest({ status: "processing", updated_at: "2026-08-15T11:55:00.000Z" }, now)).toBe(true);
    expect(isActiveSampleDataRequest({ status: "processing", updated_at: "2026-08-15T11:40:00.000Z" }, now)).toBe(false);
    expect(isActiveSampleDataRequest({ status: "completed", updated_at: "2026-08-15T11:55:00.000Z" }, now)).toBe(false);
  });
});
