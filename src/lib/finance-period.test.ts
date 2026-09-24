import { describe, expect, it } from "vitest";
import { financialPeriodStart } from "./finance-period";

describe("financial report periods", () => {
  const now = new Date("2026-08-15T12:00:00.000Z");

  it("calculates the supported lower bounds", () => {
    expect(financialPeriodStart("7d", now)).toBe("2026-08-08");
    expect(financialPeriodStart("90d", now)).toBe("2026-05-17");
    expect(financialPeriodStart("year", now)).toBe("2025-08-15");
    expect(financialPeriodStart("30d", now)).toBe("2026-07-16");
  });

  it("uses the 30-day period for unknown filters", () => {
    expect(financialPeriodStart("unknown", now)).toBe("2026-07-16");
  });

  it("counts back from the caller's local calendar day, not the UTC one", () => {
    // 23:30 local is already the next day in UTC for any zone west of UTC
    // (Uruguay: 02:30Z). The browser filters its cached list with this.
    const lateEvening = new Date(2026, 7, 15, 23, 30);
    expect(financialPeriodStart("30d", lateEvening)).toBe("2026-07-16");
    expect(financialPeriodStart("year", lateEvening)).toBe("2025-08-15");
  });
});
