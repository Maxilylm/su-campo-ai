"use client";

import { useCallback, useRef, useState } from "react";
import { fetchWithTimeout } from "@/lib/fetch";
import { sendJsonResult } from "@/lib/mutate";
import { mergeFirstPage, upsertConversation, type ChatConversationSummary } from "@/lib/chat-conversations";

const PAGE_SIZE = 30;

export type ConversationListStatus =
  /** Not asked yet (offline, or before the first load). */
  | "idle"
  | "loading"
  | "ready"
  /** Migration 052 isn't applied: single shared thread, no list. */
  | "unavailable"
  | "error";

interface ListState {
  status: ConversationListStatus;
  items: ChatConversationSummary[];
  nextCursor: string | null;
  canManage: boolean;
  userId: string | null;
}

/** The Chat page's conversation list: load, page, and keep it in step with
 * the chat (new conversation, last used first, rename, delete). */
export function useChatConversations() {
  const [state, setState] = useState<ListState>({ status: "idle", items: [], nextCursor: null, canManage: false, userId: null });
  const [loadingMore, setLoadingMore] = useState(false);
  const requestRef = useRef(0);

  const load = useCallback(async ({ silent = false }: { silent?: boolean } = {}): Promise<ConversationListStatus> => {
    const request = ++requestRef.current;
    if (!silent) setState((prev) => ({ ...prev, status: "loading" }));
    try {
      const res = await fetchWithTimeout(`/api/chat/conversations?limit=${PAGE_SIZE}`, {}, 8000);
      if (!res.ok) throw new Error("conversations request failed");
      const data = await res.json();
      if (request !== requestRef.current) return "idle";
      if (data.available === false) {
        setState({ status: "unavailable", items: [], nextCursor: null, canManage: Boolean(data.canManage), userId: null });
        return "unavailable";
      }
      const fresh = Array.isArray(data.conversations) ? data.conversations as ChatConversationSummary[] : [];
      const nextCursor = typeof data.nextCursor === "string" ? data.nextCursor : null;
      setState((prev) => {
        const items = silent ? mergeFirstPage(prev.items, fresh, Boolean(nextCursor)) : fresh;
        return {
          status: "ready",
          items,
          // A silent refresh keeps the cursor of what's already paged in.
          nextCursor: silent && prev.nextCursor && items.length > fresh.length ? prev.nextCursor : nextCursor,
          canManage: Boolean(data.canManage),
          userId: typeof data.userId === "string" ? data.userId : null,
        };
      });
      return "ready";
    } catch {
      if (request !== requestRef.current) return "idle";
      if (!silent) setState((prev) => ({ ...prev, status: "error" }));
      return silent ? "ready" : "error";
    }
  }, []);

  const loadMore = useCallback(async () => {
    const cursor = state.nextCursor;
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetchWithTimeout(`/api/chat/conversations?limit=${PAGE_SIZE}&cursor=${encodeURIComponent(cursor)}`, {}, 8000);
      if (!res.ok) throw new Error("conversations page failed");
      const data = await res.json();
      const page = Array.isArray(data.conversations) ? data.conversations as ChatConversationSummary[] : [];
      setState((prev) => {
        const known = new Set(prev.items.map((item) => item.id));
        return {
          ...prev,
          items: [...prev.items, ...page.filter((item) => !known.has(item.id))],
          nextCursor: typeof data.nextCursor === "string" ? data.nextCursor : null,
        };
      });
    } catch {
      // The button stays; the user can try again.
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, state.nextCursor]);

  /** A conversation was just created or written to: it goes to the top. */
  const touch = useCallback((conversation: Pick<ChatConversationSummary, "id"> & Partial<ChatConversationSummary>) => {
    setState((prev) => {
      const existing = prev.items.find((item) => item.id === conversation.id);
      const now = new Date().toISOString();
      const next: ChatConversationSummary = {
        id: conversation.id,
        title: conversation.title ?? existing?.title ?? "Nueva conversación",
        channel: existing?.channel ?? "web",
        created_by: existing?.created_by ?? prev.userId,
        created_at: existing?.created_at ?? now,
        updated_at: now,
      };
      return { ...prev, items: upsertConversation(prev.items, next) };
    });
  }, []);

  const rename = useCallback(async (id: string, title: string) => {
    const result = await sendJsonResult("/api/chat/conversations", "PATCH", { id, title });
    if (result.ok) {
      setState((prev) => ({ ...prev, items: prev.items.map((item) => item.id === id ? { ...item, title } : item) }));
    }
    return result;
  }, []);

  const remove = useCallback(async (id: string) => {
    const result = await sendJsonResult("/api/chat/conversations", "DELETE", { id });
    // 404: someone else already deleted it — drop it from the list as well.
    if (result.ok || result.status === 404) {
      setState((prev) => ({ ...prev, items: prev.items.filter((item) => item.id !== id) }));
    }
    return result;
  }, []);

  const forget = useCallback((id: string) => {
    setState((prev) => ({ ...prev, items: prev.items.filter((item) => item.id !== id) }));
  }, []);

  return { ...state, loadingMore, load, loadMore, touch, rename, remove, forget };
}
