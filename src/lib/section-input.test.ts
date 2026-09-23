import { describe, expect, it } from "vitest";
import { isValidSectionMapCenter, sectionFieldError } from "./section-input";

const square = [[-56, -33], [-56, -33.01], [-56.01, -33.01], [-56, -33]];

describe("sectionFieldError", () => {
  it("accepts the values the hacienda form sends", () => {
    expect(sectionFieldError({ color: "#22c55e", waterStatus: "bajo", pastureStatus: "creciendo" })).toBeNull();
    expect(sectionFieldError({})).toBeNull();
  });

  it("rejects a color that could escape its style attribute", () => {
    expect(sectionFieldError({ color: '#fff;"><img src=x onerror=alert(1)>' })).toMatch(/color/);
    expect(sectionFieldError({ color: "green" })).toMatch(/color/);
  });

  it("rejects unknown statuses", () => {
    expect(sectionFieldError({ waterStatus: "lleno" })).toMatch(/waterStatus/);
    expect(sectionFieldError({ pastureStatus: "<b>" })).toMatch(/pastureStatus/);
  });
});

describe("isValidSectionMapCenter", () => {
  it("accepts a label point, a drawn polygon, or nothing", () => {
    expect(isValidSectionMapCenter(null)).toBe(true);
    expect(isValidSectionMapCenter({ lat: -33.5, lng: -56.2 })).toBe(true);
    expect(isValidSectionMapCenter({ type: "Polygon", coordinates: [square] })).toBe(true);
  });

  it("rejects shapes the map cannot draw", () => {
    expect(isValidSectionMapCenter({ lat: "x", lng: 1 })).toBe(false);
    expect(isValidSectionMapCenter({ lat: 200, lng: 1 })).toBe(false);
    expect(isValidSectionMapCenter({ type: "Polygon", coordinates: [square.slice(0, 2)] })).toBe(false);
    expect(isValidSectionMapCenter({ type: "LineString", coordinates: square })).toBe(false);
    expect(isValidSectionMapCenter({ type: "Polygon", coordinates: [[...square, ["a", 1]]] })).toBe(false);
    expect(isValidSectionMapCenter([1, 2])).toBe(false);
  });

  it("caps polygon size", () => {
    const huge = Array.from({ length: 600 }, (_, i) => [-56 + i / 1e4, -33]);
    expect(isValidSectionMapCenter({ type: "Polygon", coordinates: [huge] })).toBe(false);
  });
});
