import { describe, it, expect } from "vitest";
import { adgByBatch, computeADG, sortByDate } from "./weight";

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

describe("adgByBatch", () => {
  const batches = [
    { id: "a", category: "Novillos", breed: "Hereford" },
    { id: "b", category: "Terneros", breed: null },
    { id: "c", category: "Vacas", breed: null },
  ];

  it("ranks batches with two weighings by kg/day, skipping the rest", () => {
    expect(adgByBatch([
      { cattle_id: "a", date: "2026-06-01", weight_kg: 300 },
      { cattle_id: "a", date: "2026-08-30", weight_kg: 345 },
      { cattle_id: "b", date: "2026-07-01", weight_kg: 180 },
      { cattle_id: "b", date: "2026-07-31", weight_kg: 177 },
      { cattle_id: "c", date: "2026-07-01", weight_kg: 450 },
      { cattle_id: "gone", date: "2026-07-01", weight_kg: 1 },
      { cattle_id: "gone", date: "2026-08-01", weight_kg: 2 },
    ], batches)).toEqual([
      { id: "a", label: "Novillos (Hereford)", adg: 0.5, weighings: 2, days: 90, lastWeight: 345 },
      { id: "b", label: "Terneros", adg: -0.1, weighings: 2, days: 30, lastWeight: 177 },
    ]);
  });

  it("skips batches weighed only on one day", () => {
    expect(adgByBatch([
      { cattle_id: "a", date: "2026-06-01", weight_kg: 300 },
      { cattle_id: "a", date: "2026-06-01", weight_kg: 310 },
    ], batches)).toEqual([]);
  });
});
