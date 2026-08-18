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
    expect(prompt.length).toBeLessThanOrEqual(4_000);
  });

  it("can focus the handoff on registering concrete tasks", () => {
    const prompt = buildInsightsChatPrompt("Hay una alerta sanitaria pendiente.", "tasks");
    expect(prompt).toContain("tareas pendientes concretas");
    expect(prompt).toContain("no inventes fechas");
    expect(prompt).toContain("alerta sanitaria pendiente");
  });
});
