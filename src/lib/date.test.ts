import { describe, expect, it } from "vitest";
import { dateInputToIso, dateInputValue, isValidDateOnly, isValidDateValue } from "./date";

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
