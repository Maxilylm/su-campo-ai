import { describe, it, expect } from "vitest";
import { toneBadge, toneText, toneTint, vaccinationTone, alertSeverityTone } from "./status-styles";

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

  it("every tone uses the theme-aware semantic tokens", () => {
    const token = { good: "ok", warn: "warn", bad: "bad" } as const;
    for (const tone of ["good", "warn", "bad"] as const) {
      expect(toneBadge(tone)).toBe(`text-${token[tone]} border-${token[tone]}-line`);
      expect(toneTint(tone)).toBe(`bg-${token[tone]}-soft text-${token[tone]}`);
    }
  });

  it("toneText maps each tone to its text token", () => {
    expect([toneText("good"), toneText("warn"), toneText("bad"), toneText("neutral")]).toEqual(["text-ok", "text-warn", "text-bad", "text-muted-foreground"]);
  });

  it("neutral falls back to muted", () => {
    expect(toneBadge("neutral")).toContain("muted");
    expect(toneTint("neutral")).toContain("muted");
  });
});
