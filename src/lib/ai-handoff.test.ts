import { describe, expect, it } from "vitest";
import { AI_HANDOFF_MAX_CHARS, aiChatHandoffKey, aiInsightsHandoffKey, buildInsightsChatPrompt, buildOperationalChatPrompt, buildWeatherChatPrompt } from "./ai-handoff";

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

  it("builds bounded prompts for operational cards", () => {
    expect(aiChatHandoffKey("user-a")).not.toBe(aiChatHandoffKey("user-b"));
    const prompt = buildOperationalChatPrompt([{ label: "Vacunación: Aftosa", detail: "Vence hoy en Norte" }], "Pendientes");
    expect(prompt).toContain("Vence hoy en Norte");
    expect(prompt).toContain("estado actual de mis datos");
    expect(prompt.length).toBeLessThanOrEqual(4_000);
  });

  it("hands the dashboard weather snapshot to Chat without claiming certainty", () => {
    const prompt = buildWeatherChatPrompt({
      place: "Tacuarembó, Uruguay",
      current: { condition: "Parcialmente nublado", temp: 22.4, wind: 18.8, precip: 0.2 },
      forecast: [{ date: "2026-08-19", condition: "Lluvia", tmin: 12.2, tmax: 19.9, precip: 4.6 }],
    });
    expect(prompt).toContain("Tacuarembó");
    expect(prompt).toContain("viento 19 km/h");
    expect(prompt).toContain("no inventes pronósticos");
    expect(prompt).toContain("2026-08-19");
  });
});
