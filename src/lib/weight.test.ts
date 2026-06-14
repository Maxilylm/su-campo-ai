import { describe, it, expect } from "vitest";
import { computeADG, sortByDate } from "./weight";

describe("sortByDate", () => {
  it("sorts ascending without mutating input", () => {
    const input = [{ date: "2026-03-01", weight_kg: 200 }, { date: "2026-01-01", weight_kg: 150 }];
    const out = sortByDate(input);
    expect(out.map((r) => r.date)).toEqual(["2026-01-01", "2026-03-01"]);
    expect(input[0].date).toBe("2026-03-01"); // original untouched
  });
});

describe("computeADG", () => {
  it("returns null with fewer than two records", () => {
    expect(computeADG([])).toBeNull();
    expect(computeADG([{ date: "2026-01-01", weight_kg: 200 }])).toBeNull();
  });

  it("computes kg/day between first and last weighing", () => {
    // +50kg over 100 days = 0.5 kg/day
    expect(computeADG([
      { date: "2026-01-01", weight_kg: 200 },
      { date: "2026-04-11", weight_kg: 250 },
    ])).toBeCloseTo(0.5, 5);
  });

  it("uses chronological extremes regardless of input order", () => {
    const adg = computeADG([
      { date: "2026-04-11", weight_kg: 250 },
      { date: "2026-01-01", weight_kg: 200 },
      { date: "2026-02-20", weight_kg: 230 },
    ]);
    expect(adg).toBeCloseTo(0.5, 5);
  });

  it("returns null when all weighings are on the same day", () => {
    expect(computeADG([
      { date: "2026-01-01", weight_kg: 200 },
      { date: "2026-01-01", weight_kg: 210 },
    ])).toBeNull();
  });

  it("can be negative on weight loss", () => {
    const adg = computeADG([
      { date: "2026-01-01", weight_kg: 250 },
      { date: "2026-01-11", weight_kg: 240 },
    ]);
    expect(adg).toBeCloseTo(-1, 5);
  });
});
