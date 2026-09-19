import { describe, expect, it } from "vitest";
import { parseLocalizedNumber } from "./number";

describe("parseLocalizedNumber", () => {
  it("accepts dot-decimal and comma-decimal values", () => {
    expect(parseLocalizedNumber("1250.50")).toBe(1250.5);
    expect(parseLocalizedNumber("1250,50")).toBe(1250.5);
  });

  it("accepts thousands separators from both spreadsheet conventions", () => {
    expect(parseLocalizedNumber("1.250,50")).toBe(1250.5);
    expect(parseLocalizedNumber("1,250.50")).toBe(1250.5);
  });

  it("ignores spaces and rejects blank or malformed values", () => {
    expect(parseLocalizedNumber(" 2 500,75 ")).toBe(2500.75);
    expect(parseLocalizedNumber(" ")).toBe(Number.NaN);
    expect(parseLocalizedNumber("not-a-number")).toBe(Number.NaN);
  });

  it("preserves negative sign (inventory adjustments, financial deltas)", () => {
    expect(parseLocalizedNumber("-3")).toBe(-3);
    expect(parseLocalizedNumber("-3,5")).toBe(-3.5);
  });

  it("behaves like Number() for plain integers, so Number.isInteger checks downstream still work", () => {
    expect(Number.isInteger(parseLocalizedNumber("5"))).toBe(true);
    expect(Number.isInteger(parseLocalizedNumber("5,5"))).toBe(false);
  });
});
