import { describe, it, expect } from "vitest";
import { buildAlerts, type AlertInputs } from "./alerts";

const NOW = new Date("2026-06-14T12:00:00Z").getTime();
const inDays = (d: number) => new Date(NOW + d * 86_400_000).toISOString();

const empty: AlertInputs = { vaccinations: [], inventory: [], health: [], crops: [] };

describe("buildAlerts", () => {
  it("returns nothing when there is nothing to flag", () => {
    expect(buildAlerts(empty, NOW)).toEqual([]);
  });

  it("flags an overdue vaccination as high severity", () => {
    const a = buildAlerts({ ...empty, vaccinations: [{ id: "1", vaccine_name: "Aftosa", next_due: inDays(-3) }] }, NOW);
    expect(a).toHaveLength(1);
    expect(a[0].kind).toBe("vaccination");
    expect(a[0].severity).toBe("high");
  });

  it("flags an upcoming vaccination as medium, ignores far-future ones", () => {
    const a = buildAlerts({ ...empty, vaccinations: [
      { id: "1", vaccine_name: "Brucelosis", next_due: inDays(10) },
      { id: "2", vaccine_name: "Rabia", next_due: inDays(99) },
    ] }, NOW);
    expect(a).toHaveLength(1);
    expect(a[0].severity).toBe("medium");
  });

  it("flags low stock; out-of-stock is high", () => {
    const a = buildAlerts({ ...empty, inventory: [
      { id: "1", name: "Ración", current_stock: 2, min_stock: 10, unit: "kg" },
      { id: "2", name: "Vacuna", current_stock: 0, min_stock: 5, unit: "dosis" },
      { id: "3", name: "OK", current_stock: 50, min_stock: 10, unit: "kg" },
    ] }, NOW);
    expect(a.map((x) => x.kind)).toEqual(["stock", "stock"]);
    expect(a.find((x) => x.title.includes("Vacuna"))?.severity).toBe("high");
  });

  it("flags unresolved health events only", () => {
    const a = buildAlerts({ ...empty, health: [
      { id: "1", type: "enfermedad", description: "fiebre", resolved: false },
      { id: "2", type: "lesion", description: "pata", resolved: true },
    ] }, NOW);
    expect(a).toHaveLength(1);
    expect(a[0].kind).toBe("health");
  });

  it("flags upcoming harvest, ignores harvested/failed/already-harvested", () => {
    const a = buildAlerts({ ...empty, crops: [
      { id: "1", crop_type: "soja", status: "growing", expected_harvest: inDays(5), actual_harvest: null },
      { id: "2", crop_type: "trigo", status: "harvested", expected_harvest: inDays(2), actual_harvest: inDays(-1) },
      { id: "3", crop_type: "maíz", status: "failed", expected_harvest: inDays(3), actual_harvest: null },
    ] }, NOW);
    expect(a).toHaveLength(1);
    expect(a[0].kind).toBe("harvest");
  });

  it("sorts high severity before medium", () => {
    const a = buildAlerts({
      ...empty,
      vaccinations: [{ id: "1", vaccine_name: "A", next_due: inDays(10) }], // medium
      inventory: [{ id: "2", name: "X", current_stock: 0, min_stock: 5, unit: "kg" }], // high
    }, NOW);
    expect(a[0].severity).toBe("high");
    expect(a[1].severity).toBe("medium");
  });
});
