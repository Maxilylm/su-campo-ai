import { describe, expect, it } from "vitest";
import { occupancyTimestamp, parseOccupancyClock } from "./occupancy-input";

const S = "11111111-1111-4111-8111-111111111111";

describe("parseOccupancyClock", () => {
  it("accepts a past date within range", () => {
    expect(parseOccupancyClock({ sectionId: S, date: "2026-09-01" }, "2026-09-22")).toEqual({ ok: true, value: { sectionId: S, date: "2026-09-01" } });
    expect(parseOccupancyClock({ sectionId: S, date: "2026-09-22" }, "2026-09-22").ok).toBe(true);
  });

  it("rejects future, ancient and malformed input", () => {
    expect(parseOccupancyClock({ sectionId: S, date: "2026-09-23" }, "2026-09-22")).toEqual({ ok: false, error: "La fecha no puede ser futura" });
    expect(parseOccupancyClock({ sectionId: S, date: "2023-09-21" }, "2026-09-22").ok).toBe(false);
    expect(parseOccupancyClock({ sectionId: S, date: "22/09/2026" }, "2026-09-22").ok).toBe(false);
    expect(parseOccupancyClock({ sectionId: "x", date: "2026-09-01" }, "2026-09-22").ok).toBe(false);
  });
});

describe("occupancyTimestamp", () => {
  it("anchors at noon UTC", () => {
    expect(occupancyTimestamp("2026-09-10")).toBe("2026-09-10T12:00:00.000Z");
  });
});
