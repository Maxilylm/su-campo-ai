import { describe, expect, it } from "vitest";
import { filterCattleRows, pageForRowId } from "./cattle-navigation";

const rows = [
  { id: "c1", category: "novillo", breed: "Hereford", ear_tag: "A-10", tag_range: null, sectionName: "Norte", origin: "propio", health_status: "healthy" },
  { id: "c2", category: "vaca", breed: "Angus", ear_tag: null, tag_range: "B-01/B-20", sectionName: "Sur", origin: "comprado", health_status: "tratamiento" },
];

describe("cattle navigation", () => {
  it("filters by section, breed, tag or health status", () => {
    expect(filterCattleRows(rows, "hereford").map((row) => row.id)).toEqual(["c1"]);
    expect(filterCattleRows(rows, "b-01").map((row) => row.id)).toEqual(["c2"]);
    expect(filterCattleRows(rows, "tratamiento").map((row) => row.id)).toEqual(["c2"]);
    expect(filterCattleRows(rows, "")).toEqual(rows);
  });

  it("returns the paginated page for a deep-linked row", () => {
    const manyRows = Array.from({ length: 41 }, (_, index) => ({ id: `c-${index}` }));
    expect(pageForRowId(manyRows, "c-20", 20)).toBe(2);
    expect(pageForRowId(manyRows, "c-40", 20)).toBe(3);
    expect(pageForRowId(manyRows, "missing", 20)).toBe(1);
  });
});
