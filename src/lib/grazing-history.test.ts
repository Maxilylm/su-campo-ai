import { describe, expect, it } from "vitest";
import { attachGrazingHistory, grazingHistoryLine, summarizeGrazingHistory } from "./grazing-history";
import { buildFieldStatus } from "./grazing";

const NOW = Date.parse("2026-09-23T12:00:00Z");
const row = (started: string, ended: string | null, heads: number) => ({ section_id: "s", started_at: started, ended_at: ended, heads_at_start: heads });

describe("summarizeGrazingHistory", () => {
  it("lists periods newest first with the rest before each", () => {
    const history = summarizeGrazingHistory([
      row("2026-06-01T12:00:00Z", "2026-06-21T12:00:00Z", 40),
      row("2026-08-01T12:00:00Z", "2026-08-15T12:00:00Z", 50),
      row("2026-09-03T12:00:00Z", null, 45),
    ], 100, NOW);
    expect(history.periods.map((period) => [period.days, period.restBeforeDays])).toEqual([[20, 19], [14, 41], [20, null]]);
    expect(history.lastRestDays).toBe(19);
    expect(history.lastRestShort).toBe(true);
  });

  it("counts animal-days inside the window only", () => {
    const history = summarizeGrazingHistory([
      row("2025-09-13T12:00:00Z", "2025-10-03T12:00:00Z", 10), // 10 of its 20 days fall inside a 365-day window
      row("2026-09-13T12:00:00Z", null, 20), // 10 days so far
    ], 40, NOW);
    expect(history.animalDays).toBe(10 * 10 + 20 * 10);
    expect(history.animalDaysPerHa).toBe(Math.round(300 / 40));
  });

  it("has no rest to judge with a single or unknown history", () => {
    expect(summarizeGrazingHistory([row("2026-09-01T12:00:00Z", null, 5)], null, NOW)).toMatchObject({ lastRestDays: null, lastRestShort: false, animalDaysPerHa: null });
    expect(summarizeGrazingHistory([], 10, NOW)).toMatchObject({ periods: [], animalDays: 0 });
  });
});

describe("peak heads", () => {
  it("uses the peak when a herd arrived batch by batch", () => {
    const history = summarizeGrazingHistory([{ ...row("2026-09-13T12:00:00Z", null, 3), peak_heads: 48 }], 10, NOW);
    expect(history.periods[0].heads).toBe(48);
    expect(history.animalDays).toBe(480);
  });
});

describe("grazingHistoryLine", () => {
  it("summarizes rest, count and pressure", () => {
    const history = summarizeGrazingHistory([
      row("2026-06-01T12:00:00Z", "2026-06-21T12:00:00Z", 40),
      row("2026-07-10T12:00:00Z", null, 40),
    ], 100, NOW);
    expect(grazingHistoryLine(history)).toBe("último descanso 19 d (corto) · 1 pastoreo registrado · 38 días-animal/ha en 12 meses");
    expect(grazingHistoryLine(undefined)).toBeNull();
  });
});

describe("attachGrazingHistory", () => {
  it("attaches per potrero and leaves potreros without periods alone", () => {
    const statuses = buildFieldStatus([{ id: "s", name: "Sur", size_hectares: 10 }, { id: "n", name: "Norte" }], [], [], NOW);
    attachGrazingHistory(statuses, [row("2026-09-13T12:00:00Z", null, 10)], NOW);
    expect(statuses[0].history?.animalDaysPerHa).toBe(10);
    expect(statuses[1].history).toBeUndefined();
  });
});
