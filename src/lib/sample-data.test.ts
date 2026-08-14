import { describe, it, expect } from "vitest";
import { buildSampleData } from "./sample-data";

describe("buildSampleData", () => {
  const data = buildSampleData();

  it("describes a populated demo farm", () => {
    expect(data.farm.operation_type).toBe("mixed");
    expect(data.sections.length).toBeGreaterThanOrEqual(3);
    expect(data.cattle.length).toBeGreaterThan(0);
  });

  it("every cattle/crop references an existing section key (referential integrity)", () => {
    const keys = new Set(data.sections.map((s) => s.key));
    for (const c of data.cattle) expect(keys.has(c.sectionKey)).toBe(true);
    for (const c of data.crops) expect(keys.has(c.sectionKey)).toBe(true);
  });

  it("section keys are unique", () => {
    const keys = data.sections.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("includes data that triggers alerts (low stock, soon-due vaccination, upcoming harvest, unresolved health)", () => {
    expect(data.inventory.some((i) => i.current_stock < i.min_stock)).toBe(true);
    expect(data.vaccinations.some((v) => v.nextDueInDays <= 30)).toBe(true);
    expect(data.crops.some((c) => c.expectedHarvestInDays <= 30)).toBe(true);
    expect(data.health_events.some((h) => !h.resolved)).toBe(true);
  });

  it("includes actionable demo tasks linked to valid sections", () => {
    const keys = new Set(data.sections.map((s) => s.key));
    expect(data.tasks.length).toBeGreaterThan(0);
    for (const task of data.tasks) {
      if (task.sectionKey) expect(keys.has(task.sectionKey)).toBe(true);
      expect(task.dueInDays).toBeGreaterThanOrEqual(0);
    }
  });
});
