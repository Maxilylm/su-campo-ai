import { describe, expect, it } from "vitest";
import {
  adjustAgendaToLocalDay,
  agendaDueTone,
  agendaWindowHorizon,
  buildAgenda,
  countOverdueBefore,
  filterAgendaWindow,
  groupAgendaByDay,
  parseAgendaWindow,
  shortAgendaLabel,
  taskIdFromAgendaItemId,
  type AgendaItem,
} from "./agenda";

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

  it("extracts only task ids from agenda item ids", () => {
    expect(taskIdFromAgendaItemId("tsk-task-1")).toBe("task-1");
    expect(taskIdFromAgendaItemId("vac-vaccine-1")).toBeNull();
    expect(taskIdFromAgendaItemId("tsk-")).toBeNull();
  });
});

const entry = (id: string, date: string, daysFromNow = 0, kind: AgendaItem["kind"] = "task"): AgendaItem => ({ id, kind, date, daysFromNow, title: `Tarea: ${id}`, detail: "", href: "#" });

describe("agenda calendar window", () => {
  const TODAY = "2026-09-24";

  it("returns null when no window is requested, so the horizon mode stays as it was", () => {
    expect(parseAgendaWindow(null, null, TODAY)).toBeNull();
  });

  it("accepts a month grid window", () => {
    expect(parseAgendaWindow("2026-08-31", "2026-10-04", TODAY)).toEqual({ window: { from: "2026-08-31", to: "2026-10-04" } });
  });

  it("rejects half-open, invalid, reversed, too long or too distant windows", () => {
    expect(parseAgendaWindow("2026-09-01", null, TODAY)).toHaveProperty("error");
    expect(parseAgendaWindow(null, "2026-09-30", TODAY)).toHaveProperty("error");
    expect(parseAgendaWindow("2026-02-30", "2026-03-10", TODAY)).toHaveProperty("error");
    expect(parseAgendaWindow("2026-09-01T00:00:00Z", "2026-09-30", TODAY)).toHaveProperty("error");
    expect(parseAgendaWindow("2026-10-01", "2026-09-01", TODAY)).toHaveProperty("error");
    expect(parseAgendaWindow("2026-09-01", "2026-12-01", TODAY)).toHaveProperty("error");
    expect(parseAgendaWindow("2029-01-01", "2029-01-31", TODAY)).toHaveProperty("error");
    expect(parseAgendaWindow("2023-01-01", "2023-01-31", TODAY)).toHaveProperty("error");
  });

  it("computes the horizon that reaches the end of the window, padded one day for the server's UTC clock", () => {
    expect(agendaWindowHorizon({ from: "2026-08-31", to: "2026-10-04" }, TODAY)).toBe(11);
    expect(agendaWindowHorizon({ from: "2026-07-27", to: "2026-08-30" }, TODAY)).toBe(0);
  });

  it("keeps only items dated inside the window, overdue ones on their original day", () => {
    const items = [entry("old", "2026-08-01", -54), entry("late", "2026-09-02", -22), entry("today", TODAY), entry("edge", "2026-10-04", 10), entry("after", "2026-10-05", 11)];
    expect(filterAgendaWindow(items, { from: "2026-08-31", to: "2026-10-04" }).map((item) => item.id)).toEqual(["late", "today", "edge"]);
  });

  it("counts overdue items dated before a day", () => {
    const items = [entry("old", "2026-08-01", -54), entry("late", "2026-09-02", -22), entry("today", TODAY)];
    expect(countOverdueBefore(items, "2026-08-31")).toBe(1);
    expect(countOverdueBefore(items, "2026-10-01")).toBe(2);
  });
});

describe("agenda item presentation", () => {
  it("drops the kind prefix for compact calendar chips", () => {
    expect(shortAgendaLabel("Tarea: Revisar alambrado")).toBe("Revisar alambrado");
    expect(shortAgendaLabel("Vacunación: Aftosa")).toBe("Aftosa");
    expect(shortAgendaLabel("Sin prefijo")).toBe("Sin prefijo");
  });

  it("colors by state: overdue bad, today warn, later neutral", () => {
    expect(agendaDueTone(entry("a", "2026-09-20", -4))).toBe("bad");
    expect(agendaDueTone(entry("b", "2026-09-24", 0, "vaccination"))).toBe("warn");
    expect(agendaDueTone(entry("c", "2026-09-30", 6))).toBe("neutral");
  });
});
