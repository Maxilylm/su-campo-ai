import { describe, expect, it } from "vitest";
import { averageValidCropYield, countActiveCrops, countOverdueDates } from "./metrics";

describe("metric calculations", () => {
  it("does not mark today's due date as overdue", () => {
    expect(countOverdueDates(["2026-08-14", "2026-08-15", "2026-08-16", null], "2026-08-15")).toBe(1);
  });

  it("averages only harvested crops with valid hectares and yield", () => {
    expect(averageValidCropYield([
      { status: "harvested", yield_kg: 3000, planted_hectares: 10 },
      { status: "harvested", yield_kg: null, planted_hectares: 5 },
      { status: "harvested", yield_kg: 1000, planted_hectares: 0 },
      { status: "harvested", yield_kg: 2000, planted_hectares: 10 },
    ])).toBe(250);
  });

  it("does not count failed or harvested crops as active", () => {
    expect(countActiveCrops([{ status: "planted" }, { status: "growing" }, { status: "failed" }, { status: "harvested" }])).toBe(2);
  });
});
