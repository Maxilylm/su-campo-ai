import { describe, expect, it } from "vitest";
import { AI_HANDOFF_MAX_CHARS, aiInsightsHandoffKey, buildInsightsChatPrompt } from "./ai-handoff";

describe("AI handoffs", () => {
  it("scopes insight handoffs to the signed-in user", () => {
    expect(aiInsightsHandoffKey("user-a")).not.toBe(aiInsightsHandoffKey("user-b"));
    expect(aiInsightsHandoffKey("user-a")).toContain("user-a");
  });

  it("creates a bounded prompt that asks Chat to use current data", () => {
    const prompt = buildInsightsChatPrompt("x".repeat(AI_HANDOFF_MAX_CHARS + 100));
    expect(prompt).toContain("estado actual de mis datos");
    expect(prompt.endsWith("x".repeat(AI_HANDOFF_MAX_CHARS))).toBe(true);
    expect(prompt).not.toContain("x".repeat(AI_HANDOFF_MAX_CHARS + 1));
  });
});
