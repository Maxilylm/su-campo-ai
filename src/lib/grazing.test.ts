import { describe, expect, it } from "vitest";
import { buildFieldStatus, cropLabel, fieldTotals, sectionNeedsAttention, type GrazingSectionInput } from "./grazing";

const NOW = Date.parse("2026-09-22T12:00:00Z");
const section = (overrides: Partial<GrazingSectionInput> = {}): GrazingSectionInput => ({ id: "s1", name: "Potrero 1", ...overrides });

describe("buildFieldStatus", () => {
  it("sums batches per section and ignores unplaced or empty batches", () => {
    const [status] = buildFieldStatus(
      [section()],
      [
        { id: "c1", section_id: "s1", category: "vaca", count: 30 },
        { id: "c2", section_id: "s1", category: "ternero", count: 12 },
        { id: "c3", section_id: "s1", category: "vaca", count: 5 },
        { id: "c4", section_id: null, category: "toro", count: 2 },
        { id: "c5", section_id: "s1", category: "toro", count: 0 },
      ],
      [],
      NOW,
    );
    expect(status.heads).toBe(47);
    expect(status.byCategory).toEqual([{ category: "vaca", count: 35 }, { category: "ternero", count: 12 }]);
    expect(status.ug).toBe(39.8);
    expect(status.summary).toBe("47 cab.");
  });

  it("flags over-capacity against the head capacity first", () => {
    const [over, high, ok] = buildFieldStatus(
      [section({ id: "a", capacity: 40 }), section({ id: "b", capacity: 40 }), section({ id: "c", capacity: 40 })],
      [
        { id: "1", section_id: "a", category: "vaca", count: 52 },
        { id: "2", section_id: "b", category: "vaca", count: 37 },
        { id: "3", section_id: "c", category: "vaca", count: 10 },
      ],
      [],
      NOW,
    );
    expect(over.stocking).toBe("over");
    expect(over.stockingReason).toBe("52 de 40 cabezas");
    expect(high.stocking).toBe("high");
    expect(ok.stocking).toBe("ok");
    expect(ok.capacityShare).toBe(0.25);
  });

  it("falls back to UG/ha when no head capacity is set", () => {
    const [status] = buildFieldStatus(
      [section({ size_hectares: "20" })],
      [{ id: "1", section_id: "s1", category: "vaca", count: 40 }],
      [],
      NOW,
    );
    expect(status.ugPerHa).toBe(2);
    expect(status.headsPerHa).toBe(2);
    expect(status.stocking).toBe("over");
    expect(status.stockingReason).toBe("2 UG/ha");
  });

  it("lists only active crops, with readable labels", () => {
    const [status] = buildFieldStatus(
      [section()],
      [],
      [
        { id: "k1", section_id: "s1", crop_type: "maiz", status: "growing" },
        { id: "k2", section_id: "s1", crop_type: "soja", status: "harvested" },
      ],
      NOW,
    );
    expect(status.crops.map((crop) => crop.label)).toEqual(["Maíz"]);
    expect(status.summary).toBe("Maíz");
  });

  it("reports days grazed only while occupied and days rested only while empty", () => {
    const [occupied, empty] = buildFieldStatus(
      [
        section({ id: "a", occupied_since: "2026-09-10T08:00:00Z", last_vacated_at: "2026-08-01T00:00:00Z" }),
        section({ id: "b", occupied_since: "2026-07-01T00:00:00Z", last_vacated_at: "2026-09-01T12:00:00Z" }),
      ],
      [{ id: "1", section_id: "a", category: "novillo", count: 1 }],
      [],
      NOW,
    );
    expect(occupied.daysOccupied).toBe(12);
    expect(occupied.daysRested).toBeNull();
    expect(occupied.summary).toBe("1 novillo · 12 d");
    expect(empty.daysOccupied).toBeNull();
    expect(empty.daysRested).toBe(21);
    expect(empty.summary).toBe("libre · 21 d descanso");
  });
});

describe("fieldTotals", () => {
  it("aggregates the whole farm", () => {
    const statuses = buildFieldStatus(
      [section({ id: "a", size_hectares: 10, capacity: 5 }), section({ id: "b", size_hectares: 30 })],
      [{ id: "1", section_id: "a", category: "vaca", count: 8 }],
      [],
      NOW,
    );
    expect(fieldTotals(statuses)).toEqual({ sections: 2, occupied: 1, heads: 8, ug: 8, hectares: 40, ugPerHa: 0.2, over: 1, high: 0 });
  });
});

describe("cropLabel", () => {
  it("normalizes accents and falls back to capitalization", () => {
    expect(cropLabel("Maíz")).toBe("Maíz");
    expect(cropLabel("colza")).toBe("Colza");
  });
});

describe("sectionNeedsAttention", () => {
  it("flags stocking, worn pasture, and occupied potreros without water", () => {
    const statuses = buildFieldStatus(
      [
        section({ id: "a" }),
        section({ id: "b", pasture_status: "sobrepastoreado" }),
        section({ id: "c", water_status: "seco" }),
        section({ id: "d", water_status: "seco" }),
        section({ id: "e", capacity: 1 }),
      ],
      [
        { id: "1", section_id: "c", category: "vaca", count: 3 },
        { id: "2", section_id: "e", category: "vaca", count: 3 },
      ],
      [],
      NOW,
    );
    expect(statuses.map(sectionNeedsAttention)).toEqual([false, true, true, false, true]);
  });
});
