import { describe, expect, it } from "vitest";
import { AI_CONTEXT_UNAVAILABLE_CODE, AI_CONTEXT_UNAVAILABLE_MESSAGE, AIFarmContextUnavailableError, isAIFarmContextUnavailableError } from "./ai-errors";

describe("AI context errors", () => {
  it("keeps the recovery code and safe user message stable", () => {
    const error = new AIFarmContextUnavailableError();
    expect(error.code).toBe(AI_CONTEXT_UNAVAILABLE_CODE);
    expect(error.message).toBe(AI_CONTEXT_UNAVAILABLE_MESSAGE);
    expect(isAIFarmContextUnavailableError(error)).toBe(true);
  });

  it("recognizes the serialized form returned across a route boundary", () => {
    expect(isAIFarmContextUnavailableError({ code: AI_CONTEXT_UNAVAILABLE_CODE })).toBe(true);
    expect(isAIFarmContextUnavailableError(new Error("other"))).toBe(false);
  });
});
