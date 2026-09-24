// CampoAI assistant entry points. The work lives in focused modules; this file
// orchestrates a chat turn and re-exports the public API so routes import
// everything from "@/lib/ai".
//   ai-farm-context.ts  reads the farm and renders the <farm_data> block
//   ai-prompt.ts        system prompts (response schema, table hints, rules)
//   ai-groq.ts          Groq HTTP client, timeouts, Whisper transcription
//   ai-action.ts        AIAction shape, normalization, read-only guard
//   ai-proposal.ts      which writes need confirmation; signed proposals
//   ai-execute.ts       applies confirmed/allowed operations to the database
import { getSupabaseAdmin } from "./supabase";
import { extractJsonObject } from "./json";
import { withTimeout, SUPABASE_READ_TIMEOUT_MS } from "./timeout";
import { messageNeedsFinancialContext, messageNeedsInsightsContext, messageNeedsInventoryContext, messageNeedsMapContext, messageNeedsWeatherContext } from "./ai-context";
import { normalizeStoredChatHistory, type ChatHistoryMessage as AIConversationMessage, pruneStaleHistory } from "./ai-conversation";
import { AIRateLimitedError } from "./ai-errors";
import { getFarmContext } from "./ai-farm-context";
import { buildChatSystemPrompt, buildSummarySystemPrompt } from "./ai-prompt";
import { AI_CHAT_COMPLETION_TIMEOUT_MS, AI_SUMMARY_TIMEOUT_MS, groqRetryAfterSec, postGroqChatCompletion } from "./ai-groq";
import { normalizeAIAction, type AIAction } from "./ai-action";
import { groqChatModelParams } from "./groq-model";
import type { ConversationTarget } from "./chat-conversations-server";

export { transcribeAudio } from "./ai-groq";
export { enforceAIWriteAccess, type AIAction } from "./ai-action";
export { requireAIConfirmation } from "./ai-proposal";
export { executeOperations } from "./ai-execute";

export type ChatHistoryMessage = AIConversationMessage;

/** Read the authoritative transcript from Supabase. Client history is
 * intentionally not trusted for AI context; a temporary history read failure
 * falls back to a context-only answer instead of blocking the request or
 * accepting forged assistant messages. With a conversationId (migration 052)
 * only that conversation is read; without one, the farm-wide shared thread
 * of older releases. */
export async function readSharedChatHistory(farmId: string, timeoutMs = SUPABASE_READ_TIMEOUT_MS, conversationId?: string): Promise<ChatHistoryMessage[]> {
  const db = getSupabaseAdmin();
  let query = db
    .from("chat_messages")
    .select("role, content, created_at, author_role")
    .eq("farm_id", farmId);
  if (conversationId) query = query.eq("conversation_id", conversationId);
  const result = await withTimeout(
    query
      .order("created_at", { ascending: false })
      .limit(20),
    timeoutMs,
    null,
  );
  if (!result) {
    console.error("Shared AI chat history read timed out; continuing without history");
    return [];
  }
  if (result.error) {
    console.error("Shared AI chat history read failed; continuing without history:", result.error.message);
    return [];
  }
  // Viewers are read-only; drop their turns from what any channel's AI call
  // reads as context, so a viewer can never steer a write-capable editor's
  // later turn through the shared transcript. Rows from before this column
  // existed have author_role null and are kept (can't retroactively know).
  const rows = (result.data || []).filter((row: { author_role?: string | null }) => row.author_role !== "viewer");
  return normalizeStoredChatHistory([...rows].reverse());
}

/** Prompt history for a chat turn's conversation target (see
 * resolveConversationTarget): a new conversation starts empty. */
export function readConversationHistory(
  farmId: string,
  target: ConversationTarget,
  timeoutMs = SUPABASE_READ_TIMEOUT_MS,
): Promise<ChatHistoryMessage[]> {
  if (target.kind === "existing") return readSharedChatHistory(farmId, timeoutMs, target.id);
  if (target.kind === "legacy") return readSharedChatHistory(farmId, timeoutMs);
  return Promise.resolve([]);
}

// Main AI processing function
export async function processMessage(
  farmId: string,
  message: string,
  messageType: string = "text",
  history: ChatHistoryMessage[] | PromiseLike<ChatHistoryMessage[]> = [],
  canWrite = true,
): Promise<AIAction> {
  if (typeof message !== "string" || !message.trim() || message.length > 4000) {
    return { intent: "help", response: "El mensaje debe tener entre 1 y 4000 caracteres." };
  }
  const [farmContext, resolvedHistory] = await Promise.all([
    getFarmContext(
      farmId,
      messageNeedsWeatherContext(message),
      messageNeedsMapContext(message),
      messageNeedsInventoryContext(message),
      messageNeedsFinancialContext(message),
      messageNeedsInsightsContext(message),
    ),
    Promise.resolve(history),
  ]);

  const systemPrompt = buildChatSystemPrompt(farmContext, canWrite);

  // Build conversation messages
  const messages: { role: string; content: string }[] = [
    { role: "system", content: systemPrompt },
  ];

  // Add the shared, bounded conversation history to keep every AI channel consistent.
  const recentHistory = pruneStaleHistory(normalizeStoredChatHistory(resolvedHistory), message);
  for (const msg of recentHistory) {
    messages.push({ role: msg.role, content: msg.content });
  }

  // Add current message
  messages.push({
    role: "user",
    content: messageType === "audio"
      ? `[Mensaje de audio transcripto]: ${message}`
      : message,
  });

  const res = await postGroqChatCompletion({
    ...groqChatModelParams(),
    messages,
    temperature: 0.3,
    max_tokens: 4000,
    response_format: { type: "json_object" },
  }, AI_CHAT_COMPLETION_TIMEOUT_MS);

  if (!res.ok) {
    const err = await res.text();
    console.error("Groq error:", err);
    if (res.status === 429) throw new AIRateLimitedError(groqRetryAfterSec(res));
    return {
      intent: "help",
      response: "Hubo un error procesando tu mensaje. Intentá de nuevo.",
    };
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;

  const parsed = normalizeAIAction(extractJsonObject<unknown>(content));
  if (parsed) {
    return parsed;
  }
  return {
    intent: "help",
    response: "No pude entender la respuesta. Intentá de nuevo con otro mensaje.",
  };
}

// Generate a short proactive "weekly summary" of the farm state. Plain text
// (no JSON). Reuses the same context builder as the chat assistant.
export async function generateFarmSummary(farmId: string): Promise<string> {
  const farmContext = await getFarmContext(farmId);

  const res = await postGroqChatCompletion({
    ...groqChatModelParams(),
    messages: [
      { role: "system", content: buildSummarySystemPrompt(farmContext) },
      { role: "user", content: "Generá el resumen semanal del campo." },
    ],
    temperature: 0.4,
    // Headroom for gpt-oss reasoning tokens; the summary itself is ~100.
    max_tokens: 800,
  }, AI_SUMMARY_TIMEOUT_MS);

  if (!res.ok) {
    console.error("Groq summary error:", await res.text());
    if (res.status === 429) throw new AIRateLimitedError(groqRetryAfterSec(res));
    throw new Error("summary_failed");
  }
  const data = await res.json();
  return (data.choices?.[0]?.message?.content || "").trim();
}
