import { describe, expect, it } from "vitest";
import { ADJACENT_DESTINATION_BONUS, attachNeighbours, buildFieldStatus, cropLabel, fieldTotals, mergeOccupancy, moveReasons, planRotation, sectionNeedsAttention, suggestDestinations, type GrazingSectionInput } from "./grazing";
import { fieldGraphFromData } from "./field-graph";

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

describe("mergeOccupancy", () => {
  it("attaches the clock by section and leaves unknown sections untouched", () => {
    const merged = mergeOccupancy(
      [section({ id: "a" }), section({ id: "b" })],
      [{ section_id: "a", occupied_since: "2026-09-10T00:00:00Z", last_vacated_at: null }],
    );
    expect(merged[0]).toMatchObject({ id: "a", occupied_since: "2026-09-10T00:00:00Z", last_vacated_at: null });
    expect(merged[1]).toEqual(section({ id: "b" }));
  });
});

describe("rotation", () => {
  const statuses = buildFieldStatus(
    [
      section({ id: "herd", name: "Potrero 1", occupied_since: "2026-08-20T00:00:00Z", capacity: 50 }),
      section({ id: "rested", name: "Potrero 2", last_vacated_at: "2026-07-01T00:00:00Z", capacity: 60 }),
      section({ id: "short", name: "Potrero 3", last_vacated_at: "2026-09-15T00:00:00Z", capacity: 60 }),
      section({ id: "small", name: "Potrero 4", last_vacated_at: "2026-06-01T00:00:00Z", capacity: 10 }),
      section({ id: "dry", name: "Potrero 5", water_status: "seco", last_vacated_at: "2026-06-01T00:00:00Z" }),
      section({ id: "crop", name: "Chacra" }),
      section({ id: "worn", name: "Potrero 6", pasture_status: "sobrepastoreado" }),
    ],
    [{ id: "b", section_id: "herd", category: "vaca", count: 40 }],
    [{ id: "k", section_id: "crop", crop_type: "soja", status: "growing" }],
    NOW,
  );

  it("says why a herd should move", () => {
    expect(moveReasons(statuses[0]).map((reason) => reason.code)).toEqual(["days"]);
    expect(moveReasons(statuses[1])).toEqual([]);
  });

  it("ranks rested, fitting potreros first and excludes the unusable ones", () => {
    const suggestions = suggestDestinations(statuses, { sectionId: "herd", heads: 40, ug: 40 });
    expect(suggestions.map((suggestion) => suggestion.sectionId)).toEqual(["rested", "short"]);
    expect(suggestions[0].notes).toContain("83 d de descanso");
    expect(suggestions[1].notes).toContain("solo 7 d de descanso");
  });

  it("never sends two herds to the same potrero", () => {
    const two = buildFieldStatus(
      [
        section({ id: "h1", name: "A", pasture_status: "seco" }),
        section({ id: "h2", name: "B", pasture_status: "sobrepastoreado" }),
        section({ id: "free", name: "C", last_vacated_at: "2026-07-01T00:00:00Z" }),
        section({ id: "free2", name: "D" }),
      ],
      [
        { id: "1", section_id: "h1", category: "vaca", count: 10 },
        { id: "2", section_id: "h2", category: "vaca", count: 10 },
      ],
      [],
      NOW,
    );
    const moves = planRotation(two);
    expect(moves.map((move) => move.destinations[0]?.sectionId)).toEqual(["free", "free2"]);
  });

  it("says when the only fitting potrero is reserved for a more urgent herd", () => {
    const one = buildFieldStatus(
      [
        section({ id: "h1", name: "A", pasture_status: "seco" }),
        section({ id: "h2", name: "B", occupied_since: "2026-08-01T00:00:00Z" }),
        section({ id: "free", name: "C" }),
      ],
      [
        { id: "1", section_id: "h1", category: "vaca", count: 10 },
        { id: "2", section_id: "h2", category: "vaca", count: 10 },
      ],
      [],
      NOW,
    );
    const [first, second] = planRotation(one);
    expect(first.destinations[0]?.sectionId).toBe("free");
    expect(second.destinations).toEqual([]);
    expect(second.reservedFor).toEqual({ sectionName: "C", forName: "A" });
  });
});

describe("linderos in rotation", () => {
  // Meters east/north → [lng, lat] near Paysandú.
  const ll = (x: number, y: number) => [-57.9 + x / (111_195 * Math.cos(32.3 * Math.PI / 180)), -32.3 + y / 111_195];
  const rect = (x: number, y: number) => ({ type: "Polygon", coordinates: [[ll(x, y), ll(x + 200, y), ll(x + 200, y + 200), ll(x, y + 200), ll(x, y)]] });
  // herd | near | mid | far in a row; "island" is drawn nowhere near.
  const rows = [
    section({ id: "herd", name: "Potrero Sur", map_center: rect(0, 0), pasture_status: "seco" }),
    section({ id: "near", name: "Potrero Norte", map_center: rect(200, 0) }),
    section({ id: "mid", name: "I-995", map_center: rect(400, 0) }),
    section({ id: "far", name: "Bajo", map_center: rect(600, 0) }),
    section({ id: "island", name: "Isla", map_center: rect(5000, 0) }),
  ];
  const statuses = buildFieldStatus(rows, [{ id: "1", section_id: "herd", category: "vaca", count: 20 }], [], NOW);
  const graph = fieldGraphFromData(rows);
  const herd = { sectionId: "herd", heads: 20, ug: 20 };

  it("records which potreros have a drawn area", () => {
    const [withPolygon] = statuses;
    expect(withPolygon.hasPolygon).toBe(true);
    const [point, none] = buildFieldStatus([section({ id: "p", map_center: { lat: -32, lng: -57 } }), section({ id: "n" })], [], [], NOW);
    expect(point.hasPolygon).toBe(false);
    expect(point.hasGeometry).toBe(true);
    expect(none.hasPolygon).toBe(false);
  });

  it("gives an adjacent destination a fixed bonus and says so", () => {
    const without = suggestDestinations(statuses, herd, undefined, 10);
    const withGraph = suggestDestinations(statuses, herd, undefined, 10, graph);
    const score = (list: typeof without, id: string) => list.find((item) => item.sectionId === id)!.score;
    expect(score(withGraph, "near") - score(without, "near")).toBe(ADJACENT_DESTINATION_BONUS);
    expect(score(withGraph, "mid")).toBe(score(without, "mid"));
    expect(withGraph[0].sectionId).toBe("near");
    expect(withGraph[0].notes[0]).toBe("lindero directo");
    expect(withGraph[0].route).toEqual({ path: ["herd", "near"], via: [], direct: true });
  });

  it("still offers non-adjacent potreros, with the way there", () => {
    const withGraph = suggestDestinations(statuses, herd, undefined, 10, graph);
    const mid = withGraph.find((item) => item.sectionId === "mid")!;
    expect(mid.notes).toContain("pasando por Potrero Norte");
    expect(mid.route).toEqual({ path: ["herd", "near", "mid"], via: ["Potrero Norte"], direct: false });
    const island = withGraph.find((item) => item.sectionId === "island")!;
    expect(island.route).toBeNull();
    expect(island.notes.some((note) => note.includes("lindero") || note.includes("pasando"))).toBe(false);
  });

  it("threads the graph through planRotation", () => {
    const [move] = planRotation(statuses, { graph });
    expect(move.destinations[0].sectionId).toBe("near");
    expect(move.destinations[0].notes[0]).toBe("lindero directo");
  });

  it("attaches each potrero's neighbours", () => {
    const copy = statuses.map((status) => ({ ...status }));
    attachNeighbours(copy, graph);
    expect(copy.find((status) => status.id === "near")!.neighbours).toEqual([
      { id: "mid", name: "I-995", gate: false },
      { id: "herd", name: "Potrero Sur", gate: false },
    ]);
    expect(copy.find((status) => status.id === "island")!.neighbours).toEqual([]);
  });
});
