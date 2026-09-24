import { describe, expect, it } from "vitest";
import { financialPeriodStart } from "./finance-period";

describe("financial report periods", () => {
  it("calculates the supported lower bounds from a calendar day", () => {
    expect(financialPeriodStart("7d", "2026-08-15")).toBe("2026-08-08");
    expect(financialPeriodStart("90d", "2026-08-15")).toBe("2026-05-17");
    expect(financialPeriodStart("year", "2026-08-15")).toBe("2025-08-15");
    expect(financialPeriodStart("30d", "2026-08-15")).toBe("2026-07-16");
  });

  it("uses the 30-day period for unknown filters", () => {
    expect(financialPeriodStart("unknown", "2026-08-15")).toBe("2026-07-16");
  });

  it("crosses month and year ends, and maps 29 Feb to 1 Mar a year back", () => {
    expect(financialPeriodStart("7d", "2026-01-03")).toBe("2025-12-27");
    expect(financialPeriodStart("year", "2028-02-29")).toBe("2027-03-01");
  });
});
