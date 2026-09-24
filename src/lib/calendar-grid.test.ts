import { describe, expect, it } from "vitest";
import {
  addDays,
  buildMonthGrid,
  dayAriaLabel,
  dayHeading,
  daysBetween,
  monthGridRange,
  monthOf,
  monthTitle,
  moveCalendarFocus,
  shiftMonth,
  weekdayIndex,
} from "./calendar-grid";

const item = (id: string, date: string) => ({ id, date });

describe("calendar date arithmetic on YYYY-MM-DD strings", () => {
  it("adds days across month and year boundaries", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
  });

  it("is DST-free: crossing a daylight-saving switch still moves exactly one day", () => {
    // Europe/US switch dates and Uruguay's former October switch.
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09");
    expect(addDays("2026-10-04", 1)).toBe("2026-10-05");
    expect(daysBetween("2026-03-01", "2026-04-01")).toBe(31);
    expect(daysBetween("2026-10-01", "2026-09-24")).toBe(-7);
  });

  it("numbers weekdays from Monday (0) to Sunday (6)", () => {
    expect(weekdayIndex("2026-09-21")).toBe(0); // lunes
    expect(weekdayIndex("2026-09-24")).toBe(3); // jueves
    expect(weekdayIndex("2026-09-27")).toBe(6); // domingo
  });

  it("shifts months across years", () => {
    expect(shiftMonth({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
    expect(monthOf("2026-09-24")).toEqual({ year: 2026, month: 9 });
  });
});

describe("month titles and labels (es-UY)", () => {
  it("says setiembre, as Uruguay does", () => {
    expect(monthTitle({ year: 2026, month: 9 })).toBe("Setiembre 2026");
    expect(monthTitle({ year: 2027, month: 1 })).toBe("Enero 2027");
  });

  it("builds screen-reader labels with the pending count", () => {
    expect(dayAriaLabel("2026-09-24", 2)).toBe("Jueves 24 de setiembre, 2 pendientes");
    expect(dayAriaLabel("2026-09-26", 1)).toBe("Sábado 26 de setiembre, 1 pendiente");
    expect(dayAriaLabel("2026-09-27", 0)).toBe("Domingo 27 de setiembre, sin pendientes");
    expect(dayAriaLabel("2026-09-24", 1, { today: true, overdue: 0 })).toBe("Jueves 24 de setiembre, hoy, 1 pendiente");
    expect(dayAriaLabel("2026-09-20", 3, { overdue: 2 })).toBe("Domingo 20 de setiembre, 3 pendientes, 2 atrasados");
  });

  it("builds a day heading", () => {
    expect(dayHeading("2026-09-24")).toBe("Jueves 24 de setiembre");
  });
});

describe("monthGridRange", () => {
  it("starts on the Monday on or before the 1st and ends on the Sunday on or after the last day", () => {
    // Setiembre 2026: 1 = martes, 30 = miércoles.
    expect(monthGridRange({ year: 2026, month: 9 })).toEqual({ start: "2026-08-31", end: "2026-10-04" });
    // Febrero 2027 starts on Monday and ends on Sunday: exactly four weeks.
    expect(monthGridRange({ year: 2027, month: 2 })).toEqual({ start: "2027-02-01", end: "2027-02-28" });
    // Marzo 2026: 1 = domingo, so six rows.
    expect(monthGridRange({ year: 2026, month: 3 })).toEqual({ start: "2026-02-23", end: "2026-04-05" });
  });
});

describe("buildMonthGrid", () => {
  const grid = buildMonthGrid({ year: 2026, month: 9 }, "2026-09-24", [
    item("late", "2026-08-31"),
    item("a", "2026-09-24"),
    item("b", "2026-09-24"),
    item("next", "2026-10-04"),
    item("outside", "2026-10-05"),
    item("timestamp", "2026-09-10T03:00:00Z"),
  ]);

  it("returns full Monday-first weeks with leading and trailing days", () => {
    expect(grid.weeks).toHaveLength(5);
    expect(grid.weeks.every((week) => week.length === 7)).toBe(true);
    expect(grid.weeks[0][0]).toMatchObject({ date: "2026-08-31", day: 31, inMonth: false, weekday: 0 });
    expect(grid.weeks[0][1]).toMatchObject({ date: "2026-09-01", day: 1, inMonth: true });
    expect(grid.weeks[4][6]).toMatchObject({ date: "2026-10-04", inMonth: false, weekend: true });
  });

  it("flags today, past days and weekends", () => {
    const days = grid.weeks.flat();
    const today = days.find((day) => day.date === "2026-09-24")!;
    expect(today.today).toBe(true);
    expect(today.past).toBe(false);
    expect(days.filter((day) => day.today)).toHaveLength(1);
    expect(days.find((day) => day.date === "2026-09-23")!.past).toBe(true);
    expect(days.filter((day) => day.weekend).map((day) => day.weekday)).toEqual(Array(10).fill(0).map((_, index) => (index % 2 === 0 ? 5 : 6)));
  });

  it("buckets items by calendar day, keeping order, including adjacent-month cells", () => {
    const byDate = new Map(grid.weeks.flat().map((day) => [day.date, day.items.map((entry) => entry.id)]));
    expect(byDate.get("2026-09-24")).toEqual(["a", "b"]);
    expect(byDate.get("2026-08-31")).toEqual(["late"]);
    expect(byDate.get("2026-10-04")).toEqual(["next"]);
    expect(byDate.get("2026-09-10")).toEqual(["timestamp"]);
    expect([...byDate.values()].flat()).not.toContain("outside");
  });
});

describe("moveCalendarFocus", () => {
  it("moves by day with left/right and by week with up/down", () => {
    expect(moveCalendarFocus("2026-09-24", "ArrowRight")).toBe("2026-09-25");
    expect(moveCalendarFocus("2026-09-01", "ArrowLeft")).toBe("2026-08-31");
    expect(moveCalendarFocus("2026-09-24", "ArrowUp")).toBe("2026-09-17");
    expect(moveCalendarFocus("2026-09-28", "ArrowDown")).toBe("2026-10-05");
  });

  it("jumps to the start and end of the week with Home/End", () => {
    expect(moveCalendarFocus("2026-09-24", "Home")).toBe("2026-09-21");
    expect(moveCalendarFocus("2026-09-24", "End")).toBe("2026-09-27");
  });

  it("jumps a month with PageUp/PageDown, clamping to the month length", () => {
    expect(moveCalendarFocus("2026-10-31", "PageUp")).toBe("2026-09-30");
    expect(moveCalendarFocus("2026-01-31", "PageDown")).toBe("2026-02-28");
  });

  it("ignores other keys", () => {
    expect(moveCalendarFocus("2026-09-24", "Enter")).toBeNull();
  });
});
