import { describe, expect, it } from "vitest";
import {
  assigneeInitial, filterTasks, filterTasksByAssignee, isTaskOpen, isTaskOverdue, isTaskStatus, snoozeDueDate, taskBoardColumns,
  taskDaysUntilDue, taskRelationLinks, taskRelationMismatch, taskStatusOptions, taskStatusPatch, toggledTaskStatus,
} from "./tasks";

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

describe("task statuses", () => {
  const now = new Date("2026-08-14T12:00:00");

  it("treats in_progress as open work", () => {
    expect(isTaskOpen("pending")).toBe(true);
    expect(isTaskOpen("in_progress")).toBe(true);
    expect(isTaskOpen("completed")).toBe(false);
    expect(isTaskOverdue("2026-08-13", "in_progress", now)).toBe(true);
  });

  it("recognizes only the three statuses", () => {
    expect(isTaskStatus("in_progress")).toBe(true);
    expect(isTaskStatus("done")).toBe(false);
    expect(isTaskStatus(undefined)).toBe(false);
  });

  it("keeps in_progress tasks in the Pendientes and Vencidas filters", () => {
    const tasks = [
      { id: "todo", due_date: null, status: "pending" as const },
      { id: "doing-late", due_date: "2026-08-10", status: "in_progress" as const },
      { id: "done", due_date: null, status: "completed" as const },
    ];
    expect(filterTasks(tasks, "pending", now).map((task) => task.id)).toEqual(["todo", "doing-late"]);
    expect(filterTasks(tasks, "overdue", now).map((task) => task.id)).toEqual(["doing-late"]);
  });

  it("offers En curso only when the migration is applied", () => {
    expect(taskStatusOptions(true)).toEqual(["pending", "in_progress", "completed"]);
    expect(taskStatusOptions(false)).toEqual(["pending", "completed"]);
  });

  it("stamps completed_at only for done tasks and toggles back to Por hacer", () => {
    expect(taskStatusPatch("completed", now)).toEqual({ status: "completed", completed_at: now.toISOString() });
    expect(taskStatusPatch("in_progress", now)).toEqual({ status: "in_progress", completed_at: null });
    expect(toggledTaskStatus("in_progress")).toBe("completed");
    expect(toggledTaskStatus("completed")).toBe("pending");
  });

  it("filters tasks assigned to the viewer", () => {
    const tasks = [{ id: "a", assigned_to: "me" }, { id: "b", assigned_to: "other" }, { id: "c", assigned_to: null }, { id: "d" }];
    expect(filterTasksByAssignee(tasks, "me").map((task) => task.id)).toEqual(["a"]);
    expect(filterTasksByAssignee(tasks, null)).toEqual([]);
  });

  it("uses a readable initial for the assignee", () => {
    expect(assigneeInitial("juan@campo.uy")).toBe("J");
    expect(assigneeInitial("  ñandu@x.uy")).toBe("Ñ");
    expect(assigneeInitial("_x@y")).toBe("X");
    expect(assigneeInitial(null)).toBe("?");
  });
});

describe("taskBoardColumns", () => {
  const done = (id: string, completedAt: string | null) => ({ id, status: "completed" as const, completed_at: completedAt });

  it("groups by status and counts every column", () => {
    const columns = taskBoardColumns([
      { id: "p", status: "pending" as const, completed_at: null },
      { id: "i", status: "in_progress" as const, completed_at: null },
      done("d", "2026-08-01T10:00:00Z"),
    ], { includeInProgress: true });
    expect(columns.map((column) => [column.status, column.label, column.tasks.map((task) => task.id), column.total])).toEqual([
      ["pending", "Por hacer", ["p"], 1],
      ["in_progress", "En curso", ["i"], 1],
      ["completed", "Hecha", ["d"], 1],
    ]);
  });

  it("shows only the latest completed tasks, newest first, but counts them all", () => {
    const tasks = [done("old", "2026-08-01T10:00:00Z"), done("new", "2026-08-03T10:00:00Z"), done("mid", "2026-08-02T10:00:00Z"), done("unknown", null)];
    const [, completed] = taskBoardColumns(tasks, { includeInProgress: false, doneLimit: 2 });
    expect(completed.tasks.map((task) => task.id)).toEqual(["new", "mid"]);
    expect(completed.total).toBe(4);
  });

  it("drops the En curso column and folds its rows into Por hacer without the migration", () => {
    const columns = taskBoardColumns([{ id: "i", status: "in_progress" as const, completed_at: null }], { includeInProgress: false });
    expect(columns.map((column) => column.status)).toEqual(["pending", "completed"]);
    expect(columns[0].tasks.map((task) => task.id)).toEqual(["i"]);
  });
});
