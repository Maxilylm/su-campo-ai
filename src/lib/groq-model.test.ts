import { describe, expect, it } from "vitest";
import { groqChatModelParams } from "./groq-model";

describe("groqChatModelParams", () => {
  it("asks gpt-oss models for low reasoning effort", () => {
    expect(groqChatModelParams("openai/gpt-oss-120b")).toEqual({ model: "openai/gpt-oss-120b", reasoning_effort: "low" });
  });

  it("sends only the model name to others, which reject the parameter", () => {
    expect(groqChatModelParams("qwen/qwen3.8-27b")).toEqual({ model: "qwen/qwen3.8-27b" });
  });
});

describe("Groq model probe", () => {
  it("classifies Groq's model lookup", async () => {
    const { classifyGroqModelResponse, groqProbeHealthy } = await import("./groq-model");
    expect(classifyGroqModelResponse(200)).toBe("ok");
    expect(classifyGroqModelResponse(404)).toBe("model_unavailable");
    expect(classifyGroqModelResponse(401)).toBe("auth_failed");
    expect(classifyGroqModelResponse(503)).toBe("unreachable");
    expect(groqProbeHealthy("model_unavailable")).toBe(false);
    expect(groqProbeHealthy("auth_failed")).toBe(false);
    expect(groqProbeHealthy("timeout")).toBe(true);
    expect(groqProbeHealthy("unreachable")).toBe(true);
  });
});

describe("groqModelUrl", () => {
  it("keeps the namespace slash literal", async () => {
    const { groqModelUrl } = await import("./groq-model");
    expect(groqModelUrl("openai/gpt-oss-120b")).toBe("https://api.groq.com/openai/v1/models/openai/gpt-oss-120b");
    expect(groqModelUrl("a b/c?d")).toBe("https://api.groq.com/openai/v1/models/a%20b/c%3Fd");
  });
});
