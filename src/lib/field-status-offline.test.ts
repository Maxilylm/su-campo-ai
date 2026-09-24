import { describe, expect, it } from "vitest";
import { parseOfflineFieldStatusSnapshot } from "./field-status-offline";
import { buildFieldStatus, fieldTotals, planRotation } from "./grazing";
import { offlineFieldStatusSnapshotKey, offlineSnapshotKeys } from "./offline";

const NOW = Date.parse("2026-09-22T12:00:00Z");
const sections = buildFieldStatus([{ id: "a", name: "Norte", pasture_status: "seco" }, { id: "b", name: "Sur" }], [{ id: "1", section_id: "a", category: "vaca", count: 10 }], [], NOW);
const snapshot = { savedAt: "2026-09-22T11:00:00Z", sections, totals: fieldTotals(sections), rotation: planRotation(sections) };

describe("parseOfflineFieldStatusSnapshot", () => {
  it("round-trips a fresh snapshot", () => {
    const parsed = parseOfflineFieldStatusSnapshot(JSON.stringify(snapshot), NOW);
    expect(parsed?.sections.map((section) => section.name)).toEqual(["Norte", "Sur"]);
    expect(parsed?.rotation[0].destinations[0].sectionId).toBe("b");
  });

  it("keeps a well-formed linderos graph and drops a malformed one", () => {
    const graph = { nodes: [{ id: "a", name: "Norte", centroid: null, areaM2: null, hasPolygon: false }], edges: [], components: [["a"]] };
    expect(parseOfflineFieldStatusSnapshot(JSON.stringify({ ...snapshot, graph }), NOW)?.graph).toEqual(graph);
    expect(parseOfflineFieldStatusSnapshot(JSON.stringify(snapshot), NOW)?.graph).toBeNull();
    const broken = parseOfflineFieldStatusSnapshot(JSON.stringify({ ...snapshot, graph: { nodes: "x" } }), NOW);
    expect(broken?.graph).toBeNull();
    expect(broken?.sections).toHaveLength(2);
  });

  it("rejects stale, malformed or foreign data", () => {
    expect(parseOfflineFieldStatusSnapshot(JSON.stringify({ ...snapshot, savedAt: "2025-01-01T00:00:00Z" }), NOW)).toBeNull();
    expect(parseOfflineFieldStatusSnapshot(JSON.stringify({ ...snapshot, sections: [{ id: 1 }] }), NOW)).toBeNull();
    expect(parseOfflineFieldStatusSnapshot("{not json", NOW)).toBeNull();
    expect(parseOfflineFieldStatusSnapshot(null, NOW)).toBeNull();
  });

  it("is removed by 'Borrar copias locales'", () => {
    expect(offlineSnapshotKeys("u1")).toContain(offlineFieldStatusSnapshotKey("u1"));
  });
});
