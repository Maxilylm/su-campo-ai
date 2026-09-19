import { describe, expect, it } from "vitest";
import { formatMoney } from "./format";

describe("formatMoney", () => {
  it("prefixes the currency code instead of a locale-mismatched $", () => {
    expect(formatMoney(1250.5, "USD")).toBe("USD 1.250,5");
  });

  it("uses es-UY grouping (dot for thousands, comma for decimals)", () => {
    expect(formatMoney(1250000, "UYU")).toBe("UYU 1.250.000");
  });

  it("never shows more than 2 decimal places", () => {
    expect(formatMoney(1250.5678, "USD")).toBe("USD 1.250,57");
  });

  it("falls back to an em dash for non-finite input instead of NaN/Infinity", () => {
    expect(formatMoney(Number.NaN, "USD")).toBe("USD —");
    expect(formatMoney(Infinity, "USD")).toBe("USD —");
  });
});
