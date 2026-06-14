import { describe, it, expect } from "vitest";
import { toneBadge, toneTint, vaccinationTone, alertSeverityTone } from "./status-styles";

describe("status-styles", () => {
  it("maps vaccination status to a tone", () => {
    expect(vaccinationTone("al_dia")).toBe("good");
    expect(vaccinationTone("vencida")).toBe("bad");
    expect(vaccinationTone("pendiente")).toBe("warn");
    expect(vaccinationTone("whatever")).toBe("warn");
  });

  it("maps alert severity to a tone", () => {
    expect(alertSeverityTone("high")).toBe("bad");
    expect(alertSeverityTone("medium")).toBe("warn");
  });

  it("every tone has dark-mode variants in badge + tint", () => {
    for (const tone of ["good", "warn", "bad"] as const) {
      expect(toneBadge(tone)).toContain("dark:");
      expect(toneTint(tone)).toContain("dark:");
      expect(toneTint(tone)).toMatch(/bg-/);
    }
  });

  it("neutral falls back to muted", () => {
    expect(toneBadge("neutral")).toContain("muted");
    expect(toneTint("neutral")).toContain("muted");
  });
});
