import { describe, expect, it } from "vitest";
import { hasUnsavedChanges } from "./unsaved-changes";

describe("hasUnsavedChanges", () => {
  it("does not prompt before a form has been initialized", () => {
    expect(hasUnsavedChanges(null, "current")).toBe(false);
  });

  it("recognizes changes from the initialized form", () => {
    expect(hasUnsavedChanges("initial", "edited")).toBe(true);
    expect(hasUnsavedChanges("initial", "initial")).toBe(false);
  });
});
