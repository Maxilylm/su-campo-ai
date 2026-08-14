import { describe, it, expect } from "vitest";
import { buildDeadlineActions } from "./briefing";

const NOW = new Date("2026-08-14T12:00:00Z").getTime();

describe("buildDeadlineActions", () => {
  it("includes overdue, today, and near-term deadlines in date order", () => {
    const actions = buildDeadlineActions([
      { id: "future", kind: "harvest", label: "Cosecha: trigo", date: "2026-10-01", sectionName: null },
      { id: "today", kind: "vaccination", label: "Vacunación: Aftosa", date: "2026-08-14T18:00:00Z", sectionName: "Norte" },
      { id: "late", kind: "harvest", label: "Cosecha: soja", date: "2026-08-10", sectionName: null },
    ], NOW);
    expect(actions.map((action) => action.id)).toEqual(["late", "today"]);
    expect(actions[0].detail).toBe("Atrasada 4d");
    expect(actions[1].detail).toBe("Vence hoy en Norte");
  });

  it("allows a custom horizon and ignores invalid dates", () => {
    const actions = buildDeadlineActions([
      { id: "near", kind: "vaccination", label: "A", date: "2026-08-20", sectionName: null },
      { id: "far", kind: "vaccination", label: "B", date: "2026-09-20", sectionName: null },
      { id: "invalid", kind: "harvest", label: "C", date: "not-a-date", sectionName: null },
    ], NOW, 10);
    expect(actions.map((action) => action.id)).toEqual(["near"]);
  });

  it("describes task deadlines like other operational actions", () => {
    const actions = buildDeadlineActions([
      { id: "task-1", kind: "task", label: "Tarea: alambrado", date: "2026-08-14", sectionName: "Norte", priority: "high" },
    ], NOW);
    expect(actions[0].detail).toBe("Vence hoy en Norte");
  });
});
