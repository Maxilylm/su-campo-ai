import { describe, it, expect } from "vitest";
import { toCSV } from "./csv";

describe("toCSV", () => {
  it("returns empty string for no rows", () => {
    expect(toCSV([])).toBe("");
  });

  it("writes a header and rows", () => {
    expect(toCSV([{ a: 1, b: "x" }, { a: 2, b: "y" }])).toBe("a,b\n1,x\n2,y");
  });

  it("quotes values with commas, quotes, or newlines", () => {
    expect(toCSV([{ a: "x,y" }])).toBe('a\n"x,y"');
    expect(toCSV([{ a: 'he said "hi"' }])).toBe('a\n"he said ""hi"""');
    expect(toCSV([{ a: "line1\nline2" }])).toBe('a\n"line1\nline2"');
  });

  it("renders null/undefined as empty and unions keys", () => {
    expect(toCSV([{ a: 1 }, { b: 2 }])).toBe("a,b\n1,\n,2");
    expect(toCSV([{ a: null }])).toBe("a\n");
  });

  it("JSON-stringifies nested objects", () => {
    expect(toCSV([{ a: { n: "Norte" } }])).toBe('a\n"{""n"":""Norte""}"');
  });
});
