import { describe, expect, it } from "vitest";
import { addCalendarDays, calendarDateLabel, dateInputToIso, dateInputValue, farmDayAnchor, farmLocalToday, isPastCalendarDate, isValidDateOnly, isValidDateValue, sortByCalendarDayDesc } from "./date";
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

describe("isPastCalendarDate", () => {
  it("treats a due date of today as due, not overdue, however it was stored", () => {
    expect(isPastCalendarDate("2026-09-23T03:00:00.000Z", "2026-09-23")).toBe(false); // form: local midnight
    expect(isPastCalendarDate("2026-09-23T00:00:00+00:00", "2026-09-23")).toBe(false); // AI/WhatsApp: UTC midnight
    expect(isPastCalendarDate("2026-09-23", "2026-09-23")).toBe(false);
  });

  it("is overdue from the next calendar day, and never for missing dates", () => {
    expect(isPastCalendarDate("2026-09-22T03:00:00.000Z", "2026-09-23")).toBe(true);
    expect(isPastCalendarDate(null, "2026-09-23")).toBe(false);
    expect(isPastCalendarDate("", "2026-09-23")).toBe(false);
  });
});

describe("calendarDateLabel", () => {
  it("shows the stored day for local-midnight, UTC-midnight and date-only values", () => {
    const expected = new Date(2026, 8, 23).toLocaleDateString("es-AR");
    expect(calendarDateLabel("2026-09-23T03:00:00.000Z")).toBe(expected);
    expect(calendarDateLabel("2026-09-23T00:00:00+00:00")).toBe(expected);
    expect(calendarDateLabel("2026-09-23")).toBe(expected);
  });

  it("returns unparseable input unchanged", () => {
    expect(calendarDateLabel("pronto")).toBe("pronto");
  });
});

describe("sortByCalendarDayDesc", () => {
  it("orders by calendar day, then by entry time within the day", () => {
    const rows = [
      { id: "form-early", date_applied: "2026-09-23T03:00:00+00:00", created_at: "2026-09-23T12:00:00+00:00" },
      { id: "ai-late", date_applied: "2026-09-23T00:00:00+00:00", created_at: "2026-09-23T18:00:00+00:00" },
      { id: "older", date_applied: "2026-09-22T03:00:00+00:00", created_at: "2026-09-23T19:00:00+00:00" },
      { id: "newer-day", date_applied: "2026-09-24", created_at: "2026-09-20T10:00:00+00:00" },
    ];
    expect(sortByCalendarDayDesc(rows, (row) => row.date_applied).map((row) => row.id))
      .toEqual(["newer-day", "ai-late", "form-early", "older"]);
  });

  it("does not mutate its input", () => {
    const rows = [{ d: "2026-01-01", created_at: null }, { d: "2026-01-02", created_at: null }];
    sortByCalendarDayDesc(rows, (row) => row.d);
    expect(rows[0].d).toBe("2026-01-01");
  });
});
