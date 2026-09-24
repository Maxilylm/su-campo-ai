"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchWithTimeout } from "@/lib/fetch";
import type { ChatMessageRecord } from "@/lib/chat";
import { historyToMessages } from "@/lib/chat-response";
import { isOfflineSnapshotFresh, offlineChatSnapshotKey, parseOfflineChatSnapshot } from "@/lib/offline";

function persistChatSnapshot(userId: string | null, messages: ChatMessageRecord[]): void {
  if (!userId) return;
  const cacheableMessages = messages
    .filter((message) => !message.audioRetry && !(message.failed && message.retryText))
    .map(({ role, text }) => ({ role, text }))
    .slice(-40);
  try {
    window.localStorage.setItem(offlineChatSnapshotKey(userId), JSON.stringify({
      messages: cacheableMessages,
      savedAt: new Date().toISOString(),
    }));
  } catch {
    // Private browsing and storage limits must not block the online chat.
  }
}

function readChatSnapshot(userId: string | null) {
  try {
    return userId ? parseOfflineChatSnapshot(window.localStorage.getItem(offlineChatSnapshotKey(userId))) : null;
  } catch {
    return null;
  }
}

interface ChatHistoryOptions {
  offlineReadOnly: boolean;
  userId: string | null;
  /** Conversations are on (052): history is per conversation. */
  conversationMode: boolean;
  /** Whether conversations are on is not known yet: wait. */
  listPending: boolean;
  /** An AI request is in flight (the snapshot waits for it). */
  loading: boolean;
  /** The requested conversation no longer exists (404). */
  onMissingConversation: (conversationId: string) => void;
}

/**
 * The Chat page's transcript: loads one conversation (or the single shared
 * thread before 052), falls back to the offline snapshot, and keeps that
 * snapshot current. Chat history is not part of the offline sync, so a
 * disconnected session shows the saved copy read-only instead of an error.
 */
export function useChatHistory({ offlineReadOnly, userId, conversationMode, listPending, loading, onMissingConversation }: ChatHistoryOptions) {
  const [messages, setMessages] = useState<ChatMessageRecord[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const [chatSnapshotSavedAt, setChatSnapshotSavedAt] = useState<string | null>(null);
  const [historyUserId, setHistoryUserId] = useState<string | null>(null);
  const historyRequestId = useRef(0);
  const historyControllerRef = useRef<AbortController | null>(null);
  const onMissingRef = useRef(onMissingConversation);
  useEffect(() => {
    onMissingRef.current = onMissingConversation;
  }, [onMissingConversation]);

  const loadHistory = useCallback(async ({ silent = false, conversationId }: { silent?: boolean; conversationId: string | null }) => {
    if (!offlineReadOnly && listPending) return;
    // An unsaved new conversation has nothing on the server; a background
    // refresh must not wipe a failed first message waiting to be retried.
    if (conversationMode && !conversationId && silent) return;
    const currentRequest = ++historyRequestId.current;
    historyControllerRef.current?.abort();
    const controller = new AbortController();
    historyControllerRef.current = controller;
    const current = () => currentRequest === historyRequestId.current && !controller.signal.aborted;
    const release = () => {
      if (historyControllerRef.current === controller) historyControllerRef.current = null;
    };
    if (!silent) {
      setHistoryLoaded(false);
      setHistoryError(false);
      setChatSnapshotSavedAt(null);
      setHistoryUserId(null);
    }
    if (offlineReadOnly) {
      const cached = readChatSnapshot(userId);
      if (current()) {
        const fresh = cached && isOfflineSnapshotFresh(cached.savedAt) ? cached : null;
        setMessages(fresh ? fresh.messages : []);
        setChatSnapshotSavedAt(fresh ? fresh.savedAt : null);
        setHistoryUserId(userId);
        setHistoryLoaded(true);
        setHistoryError(false);
      }
      release();
      return;
    }
    if (conversationMode && !conversationId) {
      setMessages([]);
      setHistoryUserId(userId);
      setHistoryLoaded(true);
      release();
      return;
    }
    const url = conversationMode && conversationId ? `/api/chat?conversationId=${encodeURIComponent(conversationId)}` : "/api/chat";
    try {
      const res = await fetchWithTimeout(url, { signal: controller.signal }, 8000);
      if (res.status === 404 && conversationMode && conversationId) {
        if (current()) onMissingRef.current(conversationId);
        return;
      }
      if (!res.ok) throw new Error("chat history request failed");
      const { messages: saved, pendingConfirmations } = await res.json();
      if (current() && Array.isArray(saved)) {
        setMessages(historyToMessages(saved, pendingConfirmations));
        setChatSnapshotSavedAt(null);
        setHistoryUserId(userId);
      }
      if (current() && !silent) setHistoryError(false);
    } catch {
      if (current() && !silent) {
        const cached = readChatSnapshot(userId);
        if (cached && isOfflineSnapshotFresh(cached.savedAt)) {
          setMessages(cached.messages);
          setChatSnapshotSavedAt(cached.savedAt);
          setHistoryUserId(userId);
          setHistoryError(false);
        } else {
          setHistoryError(true);
        }
      }
    } finally {
      if (current() && !silent) setHistoryLoaded(true);
      release();
    }
  }, [conversationMode, listPending, offlineReadOnly, userId]);

  /** Stop any in-flight load (unmount, or the page switching away). */
  const cancelHistory = useCallback(() => {
    historyRequestId.current += 1;
    historyControllerRef.current?.abort();
  }, []);

  useEffect(() => {
    if (!historyLoaded || historyUserId !== userId || loading || offlineReadOnly || !userId) return;
    persistChatSnapshot(userId, messages);
  }, [historyLoaded, historyUserId, loading, messages, offlineReadOnly, userId]);

  const forgetChatSnapshot = useCallback(() => {
    setChatSnapshotSavedAt(null);
    if (!userId) return;
    try {
      window.localStorage.removeItem(offlineChatSnapshotKey(userId));
    } catch {
      // Storage is optional; the server history is already deleted.
    }
  }, [userId]);

  return { messages, setMessages, historyLoaded, historyError, chatSnapshotSavedAt, loadHistory, cancelHistory, forgetChatSnapshot };
}
