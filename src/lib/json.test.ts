import { describe, it, expect } from "vitest";
import { extractJsonObject } from "./json";

describe("extractJsonObject", () => {
  it("parses plain JSON", () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
  });

  it("strips ```json fences", () => {
    const raw = '```json\n{"intent":"query","response":"hola"}\n```';
    expect(extractJsonObject(raw)).toEqual({ intent: "query", response: "hola" });
  });

  it("strips bare ``` fences", () => {
    expect(extractJsonObject('```\n{"ok":true}\n```')).toEqual({ ok: true });
  });

  it("ignores leading prose before the object", () => {
    const raw = 'Claro, acá está:\n{"response":"listo"}';
    expect(extractJsonObject(raw)).toEqual({ response: "listo" });
  });

  it("handles braces inside string values", () => {
    const raw = '{"response":"usá {llaves} así","n":2}';
    expect(extractJsonObject(raw)).toEqual({ response: "usá {llaves} así", n: 2 });
  });

  it("parses the first balanced object when trailing text follows", () => {
    expect(extractJsonObject('{"a":1} y algo más')).toEqual({ a: 1 });
  });

  it("returns null for empty or non-JSON input", () => {
    expect(extractJsonObject("")).toBeNull();
    expect(extractJsonObject(null)).toBeNull();
    expect(extractJsonObject("no json here")).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(extractJsonObject('{"a":}')).toBeNull();
  });
});
