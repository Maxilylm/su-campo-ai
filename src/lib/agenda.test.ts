import { describe, expect, it } from "vitest";
import { adjustAgendaToLocalDay, buildAgenda, groupAgendaByDay } from "./agenda";

const NOW = Date.parse("2026-08-15T12:00:00Z");

describe("buildAgenda", () => {
  it("combines open tasks, vaccinations and active crops in date order", () => {
    const items = buildAgenda({
      vaccinations: [{ id: "v1", vaccine_name: "Aftosa", next_due: "2026-08-15T09:00:00Z", sections: { name: "Norte" } }],
      crops: [
        { id: "c1", crop_type: "Soja", status: "growing", expected_harvest: "2026-08-20", actual_harvest: null },
        { id: "done", crop_type: "Trigo", status: "harvested", expected_harvest: "2026-08-16", actual_harvest: null },
      ],
      tasks: [
        { id: "t1", title: "Revisar alambrado", due_date: "2026-08-16", priority: "high", status: "pending" },
        { id: "t2", title: "Ya hecha", due_date: "2026-08-16", priority: "low", status: "completed" },
      ],
    }, NOW, 30);

    expect(items.map((item) => item.id)).toEqual(["vac-v1", "tsk-t1", "crp-c1"]);
    expect(items[1].priority).toBe("high");
    expect(items[0].href).toContain("vaccinationId=v1");
  });

  it("keeps overdue items but excludes dates beyond the horizon", () => {
    const items = buildAgenda({ vaccinations: [], crops: [], tasks: [
      { id: "late", title: "Atrasada", due_date: "2026-08-10", priority: "medium", status: "pending" },
      { id: "far", title: "Lejana", due_date: "2026-10-01", priority: "medium", status: "pending" },
    ] }, NOW, 30);
    expect(items).toHaveLength(1);
    expect(items[0].daysFromNow).toBe(-5);
  });
});

describe("agenda grouping", () => {
  it("recomputes local day labels without mutating input", () => {
    const source = buildAgenda({ vaccinations: [], crops: [], tasks: [
      { id: "t1", title: "Trabajo", due_date: "2026-08-16", priority: "medium", status: "pending" },
    ] }, NOW);
    const adjusted = adjustAgendaToLocalDay(source, "2026-08-16");
    expect(source[0].daysFromNow).toBe(1);
    expect(adjusted[0].daysFromNow).toBe(0);
  });

  it("separates overdue work and groups the remaining days", () => {
    const result = groupAgendaByDay([
      { id: "a", kind: "task", date: "2026-08-14", daysFromNow: -1, title: "A", detail: "", href: "#" },
      { id: "b", kind: "task", date: "2026-08-15", daysFromNow: 0, title: "B", detail: "", href: "#" },
      { id: "c", kind: "harvest", date: "2026-08-15", daysFromNow: 0, title: "C", detail: "", href: "#" },
    ]);
    expect(result.overdue).toHaveLength(1);
    expect(result.days).toHaveLength(1);
    expect(result.days[0].items).toHaveLength(2);
  });
});
