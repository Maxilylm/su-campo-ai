// Pure helpers for the Chat conversation list (migration 052). Shared by the
// API routes (titles, id validation) and the Chat page (grouping, URL).

import { farmLocalToday } from "./date";

export const DEFAULT_CONVERSATION_TITLE = "Nueva conversación";
export const LEGACY_CONVERSATION_TITLE = "Conversación anterior";
export const WHATSAPP_CONVERSATION_TITLE = "WhatsApp";
export const CONVERSATION_TITLE_MAX_CHARS = 60;
/** Matches the CHECK on chat_conversations.title. */
export const CONVERSATION_TITLE_LIMIT = 120;
/** URL search param holding the active conversation. */
export const CONVERSATION_PARAM = "c";

export type ConversationChannel = "web" | "whatsapp";

export interface ChatConversationSummary {
  id: string;
  title: string;
  channel: ConversationChannel;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeConversationId(value: unknown): string | null {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value.toLowerCase() : null;
}

function singleLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Title for a new conversation: its first user message, first line only,
 * cut at a word boundary to ~60 characters. */
export function conversationTitleFromMessage(message: string, maxChars = CONVERSATION_TITLE_MAX_CHARS): string {
  const firstLine = message.split("\n").map((line) => line.trim()).find(Boolean) || "";
  const text = singleLine(firstLine.replace(/^🎤\s*/u, "").replace(/^\[mensaje de audio transcripto\]:\s*/i, ""));
  if (!text) return DEFAULT_CONVERSATION_TITLE;
  if (text.length <= maxChars) return text;
  const window = text.slice(0, maxChars + 1);
  const lastSpace = window.lastIndexOf(" ");
  const cut = lastSpace >= maxChars / 2 ? window.slice(0, lastSpace) : text.slice(0, maxChars);
  const clean = cut.replace(/[\s,;:.\-–—]+$/u, "");
  return `${clean || cut}…`;
}

/** A user-typed title for rename: one line, 1–120 characters. */
export function normalizeConversationTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const title = singleLine(value);
  if (!title || title.length > CONVERSATION_TITLE_LIMIT) return null;
  return title;
}

/** The Chat URL for a conversation (null = a new, not yet saved one). */
export function conversationHref(pathname: string, search: string, conversationId: string | null): string {
  const params = new URLSearchParams(search);
  if (conversationId) params.set(CONVERSATION_PARAM, conversationId);
  else params.delete(CONVERSATION_PARAM);
  const query = params.toString();
  return `${pathname}${query ? `?${query}` : ""}`;
}

export type ConversationGroupKey = "today" | "yesterday" | "week" | "older";

const GROUP_LABELS: Record<ConversationGroupKey, string> = {
  today: "Hoy",
  yesterday: "Ayer",
  week: "Últimos 7 días",
  older: "Anteriores",
};
const GROUP_ORDER: ConversationGroupKey[] = ["today", "yesterday", "week", "older"];
const DAY_MS = 86_400_000;

export interface ConversationGroup<T> {
  key: ConversationGroupKey;
  label: string;
  items: T[];
}

function groupKeyFor(updatedAt: string, today: string, now: number, timeZone: string): ConversationGroupKey {
  const at = Date.parse(updatedAt);
  if (!Number.isFinite(at)) return "older";
  if (at > now) return "today";
  const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${farmLocalToday(at, timeZone)}T00:00:00Z`)) / DAY_MS);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days <= 7) return "week";
  return "older";
}

/** Hoy / Ayer / Últimos 7 días / Anteriores by the farm's calendar day,
 * keeping the list's own order inside each group. */
export function groupConversationsByDate<T extends { updated_at: string }>(
  conversations: T[],
  now: number,
  timeZone = "America/Montevideo",
): ConversationGroup<T>[] {
  const today = farmLocalToday(now, timeZone);
  const buckets = new Map<ConversationGroupKey, T[]>();
  for (const conversation of conversations) {
    const key = groupKeyFor(conversation.updated_at, today, now, timeZone);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(conversation);
    else buckets.set(key, [conversation]);
  }
  return GROUP_ORDER
    .filter((key) => buckets.has(key))
    .map((key) => ({ key, label: GROUP_LABELS[key], items: buckets.get(key)! }));
}
