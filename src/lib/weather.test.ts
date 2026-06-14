import { describe, it, expect } from "vitest";
import { weatherCodeLabel, sprayAdvice } from "./weather";

describe("weatherCodeLabel", () => {
  it("maps representative WMO codes", () => {
    expect(weatherCodeLabel(0).label).toBe("Despejado");
    expect(weatherCodeLabel(2).label).toBe("Parcialmente nublado");
    expect(weatherCodeLabel(63).label).toBe("Lluvia");
    expect(weatherCodeLabel(95).label).toBe("Tormenta");
  });
});

describe("sprayAdvice", () => {
  it("blocks spraying when rain is expected", () => {
    expect(sprayAdvice(5, 2).ok).toBe(false);
  });
  it("blocks spraying in strong wind (drift)", () => {
    expect(sprayAdvice(25, 0).ok).toBe(false);
  });
  it("warns in moderate wind", () => {
    expect(sprayAdvice(18, 0).ok).toBe(false);
  });
  it("approves calm, dry conditions", () => {
    const a = sprayAdvice(8, 0);
    expect(a.ok).toBe(true);
    expect(a.reason).toContain("aptas");
  });
});
