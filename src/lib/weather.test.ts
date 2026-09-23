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
  it("judges the wind the card displays, so one number never reads both ways", () => {
    expect(sprayAdvice(15.4, 0).ok).toBe(true);
    expect(sprayAdvice(15.5, 0)).toEqual({ ok: false, reason: "Viento moderado (16 km/h) — precaución" });
    expect(sprayAdvice(20.4, 0).reason).toMatch(/^Viento moderado \(20 km\/h\)/);
  });
  it("approves calm, dry conditions", () => {
    const a = sprayAdvice(8, 0);
    expect(a.ok).toBe(true);
    expect(a.reason).toContain("aptas");
  });
});
