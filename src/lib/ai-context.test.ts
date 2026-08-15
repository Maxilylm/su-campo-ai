import { describe, expect, it } from "vitest";
import { boundAIContextRows } from "./ai-context";

describe("AI context bounds", () => {
  it("keeps the requested limit and reports omitted rows", () => {
    expect(boundAIContextRows(["a", "b", "c"], 2)).toEqual({ items: ["a", "b"], truncated: true });
    expect(boundAIContextRows(["a", "b"], 2)).toEqual({ items: ["a", "b"], truncated: false });
  });

  it("normalizes missing results without throwing", () => {
    expect(boundAIContextRows(undefined, 5)).toEqual({ items: [], truncated: false });
  });
});
