"use client";

import { useEffect } from "react";
import { aiChatHandoffKey, aiInsightsHandoffKey } from "@/lib/ai-handoff";
import { CONVERSATION_PARAM } from "@/lib/chat-conversations";

const OPERATIONAL_SOURCES = ["alerts", "agenda", "weather", "activity", "reports", "metrics", "weight", "module"];

/** A handoff from another page (?from=…) always starts a new conversation. */
export function isChatHandoffUrl(search: string): boolean {
  return new URLSearchParams(search).has("from");
}

/**
 * An insight or operational card can hand its exact generated context into
 * Chat without putting farm data in the URL. The handoff is one-time and
 * scoped to this user; it lands in the composer of a new conversation.
 */
export function useChatHandoff(userId: string | null, onPrompt: (text: string) => void) {
  useEffect(() => {
    if (!userId || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const fromInsights = params.get("from") === "insights";
    const fromOperationalCard = OPERATIONAL_SOURCES.includes(params.get("from") || "");
    if (!fromInsights && !fromOperationalCard) return;
    try {
      const handoffKey = fromInsights ? aiInsightsHandoffKey(userId) : aiChatHandoffKey(userId);
      const handoff = window.sessionStorage.getItem(handoffKey);
      if (handoff) {
        onPrompt(handoff);
        window.sessionStorage.removeItem(handoffKey);
      }
    } catch {
      // Storage is optional; Chat remains fully usable without the handoff.
    }
    params.delete("from");
    params.delete(CONVERSATION_PARAM);
    const nextQuery = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}${window.location.hash}`);
    // onPrompt is a state setter; the handoff is read once per user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);
}
