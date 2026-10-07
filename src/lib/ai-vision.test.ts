import { describe, expect, it } from "vitest";
import { extractJsonObject, isAcceptableImageDataUrl } from "./ai-vision";

describe("extractJsonObject", () => {
  it("reads fenced and bare JSON", () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJsonObject('Aquí va: {"rows":[]} listo')).toEqual({ rows: [] });
  });
  it("returns null for garbage", () => {
    expect(extractJsonObject("sin json")).toBeNull();
    expect(extractJsonObject("{roto")).toBeNull();
  });
});

describe("isAcceptableImageDataUrl", () => {
  it("accepts small images and rejects other inputs", () => {
    expect(isAcceptableImageDataUrl("data:image/png;base64,iVBORw0KGgo=")).toBe(true);
    expect(isAcceptableImageDataUrl("data:text/html;base64,PGh0bWw+")).toBe(false);
    expect(isAcceptableImageDataUrl("https://example.com/a.png")).toBe(false);
    expect(isAcceptableImageDataUrl("data:image/png;base64," + "A".repeat(6 * 1024 * 1024))).toBe(false);
  });
});
