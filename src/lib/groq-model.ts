import { env } from "./env";
/** gpt-oss models reason before answering, and those hidden tokens count
 * against max_tokens; "low" keeps replies fast and leaves the budget for the
 * answer. Other models reject the parameter, so it is sent only to gpt-oss. */
export function groqChatModelParams(model = env.groqChatModel): { model: string; reasoning_effort?: "low" } {
  return model.startsWith("openai/gpt-oss") ? { model, reasoning_effort: "low" } : { model };
}
