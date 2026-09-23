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
