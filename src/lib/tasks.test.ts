import { describe, expect, it } from "vitest";
import { isTaskOverdue, taskDaysUntilDue } from "./tasks";

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
});
