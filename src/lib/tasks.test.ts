import { describe, expect, it } from "vitest";
import { filterTasks, isTaskOverdue, snoozeDueDate, taskDaysUntilDue, taskRelationLinks, taskRelationMismatch } from "./tasks";

describe("task due dates", () => {
  const now = new Date("2026-08-14T12:00:00");

  it("calculates days from the current local day", () => {
    expect(taskDaysUntilDue(null, now)).toBeNull();
    expect(taskDaysUntilDue("2026-08-14", now)).toBe(0);
    expect(taskDaysUntilDue("2026-08-16", now)).toBe(2);
  });

  it("only marks pending tasks as overdue", () => {
    expect(isTaskOverdue("2026-08-13", "pending", now)).toBe(true);
    expect(isTaskOverdue("2026-08-13", "completed", now)).toBe(false);
    expect(isTaskOverdue("2026-08-14", "pending", now)).toBe(false);
  });

  it("filters overdue tasks without including completed work", () => {
    const tasks = [
      { id: "late", due_date: "2026-08-13", status: "pending" as const },
      { id: "today", due_date: "2026-08-14", status: "pending" as const },
      { id: "done", due_date: "2026-08-13", status: "completed" as const },
    ];
    expect(filterTasks(tasks, "overdue", now).map((task) => task.id)).toEqual(["late"]);
    expect(filterTasks(tasks, "completed", now).map((task) => task.id)).toEqual(["done"]);
  });

  it("builds navigable links for each related field entity", () => {
    expect(taskRelationLinks({
      section_id: "north section",
      cattle_id: "cattle-1",
      crop_id: "crop-1",
      sections: { name: "Norte" },
      cattle: { category: "terneros", count: 18 },
      crops: { crop_type: "soja" },
    })).toEqual([
      { label: "Sección: Norte", href: "/produccion/hacienda?sectionId=north%20section" },
      { label: "Hacienda: terneros (18)", href: "/produccion/hacienda?cattleId=cattle-1" },
      { label: "Cultivo: soja", href: "/produccion/agricultura?cropId=crop-1" },
    ]);
  });

  it("keeps the relation visible when an entity id is unavailable", () => {
    expect(taskRelationLinks({ sections: { name: "Norte" } })).toEqual([
      { label: "Sección: Norte", href: null },
    ]);
  });

  it("detects a relation assigned to a different section", () => {
    expect(taskRelationMismatch("north", "south")).toBe(true);
    expect(taskRelationMismatch("north", "north")).toBe(false);
    expect(taskRelationMismatch("north", null)).toBe(false);
    expect(taskRelationMismatch(null, "south")).toBe(false);
  });
});

describe("snoozeDueDate", () => {
  it("moves an overdue task to tomorrow, not to the day after its old date", () => {
    expect(snoozeDueDate("2026-09-10", "2026-09-23")).toBe("2026-09-24");
  });

  it("moves a task due today to tomorrow and a future one by a day", () => {
    expect(snoozeDueDate("2026-09-23", "2026-09-23")).toBe("2026-09-24");
    expect(snoozeDueDate("2026-09-30", "2026-09-23")).toBe("2026-10-01");
  });

  it("accepts a timestamp due date and rejects invalid input", () => {
    expect(snoozeDueDate("2026-09-10T03:00:00.000Z", "2026-09-23")).toBe("2026-09-24");
    expect(snoozeDueDate("", "2026-09-23")).toBeUndefined();
  });
});
