import { describe, expect, it } from "vitest";
import {
  AI_CONTEXT_UNAVAILABLE_CODE,
  AI_CONTEXT_UNAVAILABLE_MESSAGE,
  AI_RATE_LIMITED_CODE,
  AIFarmContextUnavailableError,
  AIRateLimitedError,
  aiRateLimitRetryAfterSec,
  isAIFarmContextUnavailableError,
  isAIRateLimitedError,
} from "./ai-errors";

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

describe("AI rate-limit errors", () => {
  it("carries the code and the upstream Retry-After through", () => {
    const error = new AIRateLimitedError(37);
    expect(error.code).toBe(AI_RATE_LIMITED_CODE);
    expect(isAIRateLimitedError(error)).toBe(true);
    expect(aiRateLimitRetryAfterSec(error)).toBe(37);
  });

  it("recognizes the serialized form and falls back to a default Retry-After", () => {
    expect(isAIRateLimitedError({ code: AI_RATE_LIMITED_CODE })).toBe(true);
    expect(aiRateLimitRetryAfterSec({ code: AI_RATE_LIMITED_CODE }, 20)).toBe(20);
    expect(aiRateLimitRetryAfterSec({ code: AI_RATE_LIMITED_CODE, retryAfterSec: 5 })).toBe(5);
  });

  it("never confuses a rate-limit error with a context-unavailable one", () => {
    expect(isAIRateLimitedError(new AIFarmContextUnavailableError())).toBe(false);
    expect(isAIFarmContextUnavailableError(new AIRateLimitedError(10))).toBe(false);
  });
});
