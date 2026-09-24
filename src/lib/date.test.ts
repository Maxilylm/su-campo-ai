import { describe, expect, it } from "vitest";
import { addCalendarDays, dateInputToIso, dateInputValue, farmDayAnchor, farmLocalToday, isValidDateOnly, isValidDateValue } from "./date";
import { buildDeadlineActions } from "./briefing";

describe("calendar date helpers", () => {
  it("formats the local calendar day without converting it to UTC", () => {
    const date = new Date(2026, 7, 14, 23, 45);
    expect(dateInputValue(date)).toBe("2026-08-14");
  });

  it("rejects impossible calendar days instead of relying on Date normalization", () => {
    expect(isValidDateOnly("2024-02-29")).toBe(true);
    expect(isValidDateOnly("2026-02-29")).toBe(false);
    expect(isValidDateOnly("2026-04-31")).toBe(false);
    expect(isValidDateValue("2026-02-31")).toBe(false);
    expect(isValidDateValue("2026-02-28T12:00:00.000Z")).toBe(true);
    expect(isValidDateValue("2026-02-28Tnot-a-time")).toBe(false);
  });

  it("shifts calendar dates across month and leap-year boundaries", () => {
    expect(addCalendarDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addCalendarDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addCalendarDays("2028-02-29", 1)).toBe("2028-03-01");
    expect(addCalendarDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("rejects invalid calendar shifts", () => {
    expect(addCalendarDays("2026-02-30", 1)).toBeUndefined();
    expect(addCalendarDays("2026-01-01", 1.5)).toBeUndefined();
  });

  it("converts a date input at local midnight", () => {
    const value = dateInputToIso("2026-08-14");
    expect(value).toBeDefined();
    const date = new Date(value!);
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(7);
    expect(date.getDate()).toBe(14);
  });

  it("rejects malformed and impossible dates", () => {
    expect(dateInputToIso("14/08/2026")).toBeUndefined();
    expect(dateInputToIso("2026-02-30")).toBeUndefined();
  });
});

describe("farmLocalToday", () => {
  it("uses the farm's day, not the server's UTC day", () => {
    // 23:30 local on the 23rd is already the 24th in UTC.
    expect(farmLocalToday(Date.parse("2026-09-24T02:30:00Z"))).toBe("2026-09-23");
    expect(farmLocalToday(Date.parse("2026-09-23T15:00:00Z"))).toBe("2026-09-23");
  });
});

describe("farmDayAnchor", () => {
  it("is noon UTC of the farm-local day, so UTC day math reads the farm's day", () => {
    expect(farmDayAnchor(Date.parse("2026-09-24T01:00:00Z"))).toBe(Date.parse("2026-09-23T12:00:00Z"));
    expect(farmDayAnchor(Date.parse("2026-09-23T15:00:00Z"))).toBe(Date.parse("2026-09-23T12:00:00Z"));
  });

  it("keeps a task due today 'today' at 22:00 farm time", () => {
    const at22Local = Date.parse("2026-09-24T01:00:00Z");
    const [action] = buildDeadlineActions([{ id: "t", kind: "task", label: "Tarea: Revisar aguadas", date: "2026-09-23" }], farmDayAnchor(at22Local));
    expect(action.daysUntil).toBe(0);
  });
});
