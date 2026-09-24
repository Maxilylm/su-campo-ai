"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useFarm } from "@/contexts/FarmContext";
import { PageHeader } from "@/components/PageHeader";
import { ChatComposer } from "@/components/chat/ChatComposer";
import { ChatEmptyState } from "@/components/chat/ChatEmptyState";
import { ChatMessageItem, ChatThinking } from "@/components/chat/ChatMessageItem";
import { useVoiceRecorder } from "@/components/chat/useVoiceRecorder";
import { LoadErrorState } from "@/components/LoadErrorState";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { notifyDataChanged, sendJsonResult } from "@/lib/mutate";
import { fetchWithTimeout } from "@/lib/fetch";
import { prepareChatRequest, type ChatMessageRecord } from "@/lib/chat";
import { isOfflineSnapshotFresh, offlineChatSnapshotKey, parseOfflineChatSnapshot } from "@/lib/offline";
import { useOfflineAwareNavigation } from "@/lib/use-offline-aware-navigation";
import { aiChatHandoffKey, aiInsightsHandoffKey } from "@/lib/ai-handoff";
import { assistantMessageFromResponse, chatFailureText, historyToMessages, responseHasPendingConfirmation } from "@/lib/chat-response";
import { AI_CONTEXT_UNAVAILABLE_CODE } from "@/lib/ai-errors";
import { isExplicitAIConfirmation } from "@/lib/ai-confirmation-text";

// ─── Types ──────────────────────────────────

type ChatMessage = ChatMessageRecord;
const MAX_AUDIO_RETRY_PAYLOADS = 3;
const CHAT_HISTORY_POLL_MS = 30_000;

function persistChatSnapshot(userId: string | null, messages: ChatMessage[]): void {
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

// ─── Page Component ─────────────────────────

export default function ChatPage() {
  const { refreshSections, userId, offlineMode, isOnline, readOnly: permissionReadOnly } = useFarm();
  const navigate = useOfflineAwareNavigation();
  const offlineReadOnly = offlineMode || !isOnline;
  const actionReadOnly = offlineReadOnly;
  const historyWriteReadOnly = offlineReadOnly || permissionReadOnly;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const [chatSnapshotSavedAt, setChatSnapshotSavedAt] = useState<string | null>(null);
  const [historyUserId, setHistoryUserId] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const historyRequestId = useRef(0);
  const historyControllerRef = useRef<AbortController | null>(null);
  const audioRetryStoreRef = useRef(new Map<string, { blob: Blob; mimeType: string }>());

  // Load chat history when connectivity is available. Chat history is not part
  // of the offline snapshot, so a disconnected session should show the chat
  // shell in read-only mode instead of a misleading load error.
  const loadHistory = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    const currentRequest = ++historyRequestId.current;
    historyControllerRef.current?.abort();
    const controller = new AbortController();
    historyControllerRef.current = controller;
    if (!silent && currentRequest === historyRequestId.current) {
      setHistoryLoaded(false);
      setHistoryError(false);
      setChatSnapshotSavedAt(null);
      setHistoryUserId(null);
    }
    if (offlineReadOnly) {
      let cached = null;
      try {
        cached = userId
          ? parseOfflineChatSnapshot(window.localStorage.getItem(offlineChatSnapshotKey(userId)))
          : null;
      } catch {
        cached = null;
      }
      if (currentRequest === historyRequestId.current) {
        if (cached && isOfflineSnapshotFresh(cached.savedAt)) {
          setMessages(cached.messages);
          setChatSnapshotSavedAt(cached.savedAt);
        } else {
          setMessages([]);
          setChatSnapshotSavedAt(null);
        }
        setHistoryUserId(userId);
        setHistoryLoaded(true);
        setHistoryError(false);
      }
      if (historyControllerRef.current === controller) historyControllerRef.current = null;
      return;
    }
    if (!silent && currentRequest === historyRequestId.current) {
      setHistoryLoaded(false);
        if (!silent) setHistoryError(false);
    }
    try {
      const res = await fetchWithTimeout("/api/chat", { signal: controller.signal }, 8000);
      if (!res.ok) throw new Error("chat history request failed");
      const { messages: saved, pendingConfirmations } = await res.json();
      if (currentRequest === historyRequestId.current && !controller.signal.aborted && Array.isArray(saved)) {
        setMessages(historyToMessages(saved, pendingConfirmations));
        setChatSnapshotSavedAt(null);
        setHistoryUserId(userId);
      }
      if (currentRequest === historyRequestId.current && !controller.signal.aborted && !silent) setHistoryError(false);
    } catch {
      if (currentRequest === historyRequestId.current && !controller.signal.aborted && !silent) {
        let cached = null;
        try {
          cached = userId
            ? parseOfflineChatSnapshot(window.localStorage.getItem(offlineChatSnapshotKey(userId)))
            : null;
        } catch {
          cached = null;
        }
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
      if (currentRequest === historyRequestId.current && !controller.signal.aborted && !silent) setHistoryLoaded(true);
      if (historyControllerRef.current === controller) historyControllerRef.current = null;
    }
  }, [offlineReadOnly, userId]);

  useEffect(() => {
    void loadHistory();
    return () => {
      historyRequestId.current += 1;
      historyControllerRef.current?.abort();
    };
  }, [loadHistory]);

  // WhatsApp and other tabs can append to the shared transcript without
  // emitting a local browser event. Keep an open Chat current while avoiding
  // visible loading states or interference with an in-flight AI request.
  useEffect(() => {
    if (offlineReadOnly || !userId) return;
    const timer = setInterval(() => {
      if (!loading) void loadHistory({ silent: true });
    }, CHAT_HISTORY_POLL_MS);
    return () => clearInterval(timer);
  }, [loadHistory, loading, offlineReadOnly, userId]);

  // An insight can hand its exact generated context into Chat without putting
  // farm data in the URL. The handoff is one-time and scoped to this user.
  useEffect(() => {
    if (!userId || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const fromInsights = params.get("from") === "insights";
    const fromOperationalCard = ["alerts", "agenda", "weather", "activity", "reports", "metrics", "weight", "module"].includes(params.get("from") || "");
    if (!fromInsights && !fromOperationalCard) return;
    try {
      const handoffKey = fromInsights ? aiInsightsHandoffKey(userId) : aiChatHandoffKey(userId);
      const handoff = window.sessionStorage.getItem(handoffKey);
      if (handoff) {
        setInput(handoff);
        window.sessionStorage.removeItem(handoffKey);
      }
    } catch {
      // Storage is optional; Chat remains fully usable without the handoff.
    }
    params.delete("from");
    const nextQuery = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}${window.location.hash}`);
  }, [userId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!historyLoaded || historyUserId !== userId || loading || offlineReadOnly || !userId) return;
    persistChatSnapshot(userId, messages);
  }, [historyLoaded, historyUserId, loading, messages, offlineReadOnly, userId]);

  // Drop retained audio payloads on unmount (the recorder hook releases the mic).
  useEffect(() => {
    const audioRetryStore = audioRetryStoreRef.current;
    return () => audioRetryStore.clear();
  }, []);

  const { recording, recordingTime, startRecording, stopRecording, cancelRecording } = useVoiceRecorder({
    disabled: actionReadOnly || loading,
    onRecorded: (audioBlob, mimeType) => {
      if (actionReadOnly || !navigator.onLine) {
        setMessages((prev) => [...prev, { role: "assistant", text: "El audio no se envió porque no hay conexión.", failed: true }]);
        return;
      }
      void sendAudio(audioBlob, mimeType);
    },
    onUnavailable: () => {
      setMessages((prev) => [...prev, { role: "assistant", text: "No se pudo acceder al micrófono. Revisá los permisos del navegador e intentá de nuevo." }]);
    },
  });

  async function onDataChange() {
    try {
      await refreshSections();
    } catch {
      // The AI response already succeeded; a stale section list is recoverable
      // through the shared refresh flow and must not become an unhandled error.
    }
  }

  async function sendMessage(
    text: string,
    retrying = false,
    confirmationOverride?: { token: string; requestId: string },
  ) {
    const normalizedText = text.trim();
    if (!normalizedText || loading || actionReadOnly) return;

    const lastMessage = messages[messages.length - 1];
    // Only the confirmation button carries a proposal token: typed text is always
    // a new request, so it can never apply an older proposal by accident.
    const pendingConfirmation = confirmationOverride && isExplicitAIConfirmation(normalizedText)
      ? confirmationOverride
      : null;
    const requestId = retrying
      && lastMessage?.failed
      && lastMessage.retryText === normalizedText
      && lastMessage.retryRequestId
      ? lastMessage.retryRequestId
      : pendingConfirmation?.requestId || crypto.randomUUID();
    const prepared = prepareChatRequest(messages, text, retrying);

    setMessages(prepared.nextMessages);
    setInput("");
    setLoading(true);

    let contextUnavailable = false;
    try {
      const res = await fetchWithTimeout("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": requestId },
        body: JSON.stringify({
          message: prepared.normalizedText,
          ...(pendingConfirmation ? { confirmationToken: pendingConfirmation.token } : {}),
        }),
      }, 27_000);
      const data = await res.json().catch(() => ({}));
      contextUnavailable = data.code === AI_CONTEXT_UNAVAILABLE_CODE;
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "No se pudo procesar el mensaje.");
      setMessages((prev) => [...prev, assistantMessageFromResponse(data)]);
      if (pendingConfirmation) {
        setMessages((prev) => prev.map((item) => item.pendingConfirmationToken === pendingConfirmation.token
          ? { ...item, pendingConfirmationToken: undefined, pendingConfirmationRequestId: undefined, pendingConfirmationExpiresAt: undefined, pendingConfirmationProposalRequestId: undefined, pendingConfirmationLinks: undefined }
          : item));
      }
      if (!responseHasPendingConfirmation(data) && (data.intent === "update" || data.intent === "setup")) {
        notifyDataChanged();
        onDataChange();
      }
    } catch (error) {
      const detail = chatFailureText(error);
      setMessages((prev) => [...prev, {
        role: "assistant",
        text: detail,
        failed: true,
        retryText: normalizedText,
        retryRequestId: requestId,
        ...(contextUnavailable ? { aiContextUnavailable: true } : {}),
        ...(pendingConfirmation ? {
          pendingConfirmationToken: pendingConfirmation.token,
          pendingConfirmationRequestId: pendingConfirmation.requestId,
        } : {}),
      }]);
    } finally {
      setLoading(false);
    }
  }

  function send() {
    if (actionReadOnly) return;
    void sendMessage(input);
  }

  async function sendAudio(audioBlob: Blob, mimeType: string, requestId = crypto.randomUUID()) {
    if (loading || actionReadOnly || !navigator.onLine) return;

    if (!audioRetryStoreRef.current.has(requestId) && audioRetryStoreRef.current.size >= MAX_AUDIO_RETRY_PAYLOADS) {
      const oldestRequestId = audioRetryStoreRef.current.keys().next().value;
      if (typeof oldestRequestId === "string") audioRetryStoreRef.current.delete(oldestRequestId);
    }
    audioRetryStoreRef.current.set(requestId, { blob: audioBlob, mimeType });
    setMessages((prev) => {
      const existingUserIdx = prev.findLastIndex((message) => message.role === "user" && message.audioRequestId === requestId);
      if (existingUserIdx < 0) {
        return [...prev, { role: "user", text: "🎤 Enviando audio…", audioRequestId: requestId }];
      }
      const updated = [...prev];
      updated[existingUserIdx] = { role: "user", text: "🎤 Reintentando audio…", audioRequestId: requestId };
      return updated;
    });
    setLoading(true);

    let contextUnavailable = false;
    try {
      const formData = new FormData();
      formData.append("audio", audioBlob, "recording.webm");

      const res = await fetchWithTimeout("/api/chat/audio", { method: "POST", headers: { "Idempotency-Key": requestId }, body: formData }, 27_000);
      const data = await res.json().catch(() => ({}));
      contextUnavailable = data.code === AI_CONTEXT_UNAVAILABLE_CODE;
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "No se pudo procesar el audio.");

      audioRetryStoreRef.current.delete(requestId);
      setMessages((prev) => {
        const updated = [...prev];
        const lastUserIdx = updated.findLastIndex((message) => message.role === "user" && message.audioRequestId === requestId);
        if (lastUserIdx >= 0) {
          updated[lastUserIdx] = { role: "user", text: `🎤 ${data.transcription || "Audio"}` };
        }
        return [...updated, assistantMessageFromResponse(data)];
      });

      if (!responseHasPendingConfirmation(data) && (data.intent === "update" || data.intent === "setup")) {
        notifyDataChanged();
        onDataChange();
      }
    } catch (error) {
      const detail = chatFailureText(error);
      setMessages((prev) => [...prev, {
        role: "assistant",
        text: detail,
        failed: true,
        retryText: "🎤 Reintentar audio",
        retryRequestId: requestId,
        audioRetry: true,
        ...(contextUnavailable ? { aiContextUnavailable: true } : {}),
      }]);
    } finally {
      setLoading(false);
    }
  }

  function retryAudio(requestId: string) {
    const savedAudio = audioRetryStoreRef.current.get(requestId);
    if (!savedAudio || loading || actionReadOnly || !navigator.onLine) return;
    setMessages((prev) => prev.filter((message) => !(message.failed && message.audioRetry && message.retryRequestId === requestId)));
    void sendAudio(savedAudio.blob, savedAudio.mimeType, requestId);
  }

  async function clearHistory() {
    if (historyWriteReadOnly) return;
    const result = await sendJsonResult("/api/chat", "DELETE");
    if (result.ok) {
      setMessages([]);
      setChatSnapshotSavedAt(null);
      if (userId) {
        try {
          window.localStorage.removeItem(offlineChatSnapshotKey(userId));
        } catch {
          // Storage is optional; the server history is already deleted.
        }
      }
      toast.success("Historial borrado");
    } else {
      toast.error(result.error || "No se pudo borrar el historial");
    }
  }

  const frame = "mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 pt-6 sm:px-6 lg:pt-8";

  if (!historyLoaded) {
    return (
      <main className={frame} aria-busy="true" aria-label="Cargando conversación">
        <Skeleton className="mb-2 h-8 w-40" />
        <Skeleton className="mb-10 h-4 w-72 max-w-full" />
        <div className="space-y-6">
          <Skeleton className="ml-auto h-9 w-1/2 rounded-lg" />
          <div className="flex gap-3">
            <Skeleton className="h-6 w-6 rounded-md" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          </div>
        </div>
      </main>
    );
  }

  if (historyError) {
    return <main className={frame}><LoadErrorState title="No se pudo cargar el chat" onRetry={() => void loadHistory()} /></main>;
  }

  return (
    <main className={frame}>
      <PageHeader
        title="CampoAI"
        description="Tu asistente del campo: preguntá o cargá datos por texto o por audio."
        actions={messages.length > 0 ? (
          <ConfirmDialog
            trigger={<Button variant="ghost" size="sm" disabled={historyWriteReadOnly} className="text-muted-foreground">Borrar historial</Button>}
            title="¿Borrar el historial?"
            description="Se eliminarán todos los mensajes de esta conversación. Esta acción no se puede deshacer."
            confirmLabel="Borrar"
            onConfirm={clearHistory}
          />
        ) : undefined}
      />
      {chatSnapshotSavedAt && (
        <p role="status" className="mb-6 rounded-md border border-warn-line bg-warn-soft px-3 py-2 text-sm text-foreground">
          {offlineReadOnly ? "Sin conexión: mostrando el historial guardado" : "No se pudo actualizar el historial: mostrando la última copia guardada"} del {new Date(chatSnapshotSavedAt).toLocaleString("es-UY")}.
        </p>
      )}
      <div className="flex flex-1 flex-col gap-6 pb-6" role="log" aria-live="polite" aria-label="Conversación">
        {messages.length === 0 && (
          <ChatEmptyState viewer={permissionReadOnly} disabled={actionReadOnly} onPick={setInput} />
        )}
        {messages.map((m, i) => (
          <ChatMessageItem
            key={i}
            message={m}
            canRetry={Boolean(m.failed && m.retryText && (m.audioRetry || !m.retryText.startsWith("🎤")))}
            retryDisabled={loading || actionReadOnly || Boolean(m.audioRetry && (!m.retryRequestId || !audioRetryStoreRef.current.has(m.retryRequestId)))}
            confirmDisabled={loading || actionReadOnly}
            onRetry={() => m.audioRetry && m.retryRequestId ? retryAudio(m.retryRequestId) : void sendMessage(m.retryText || "", true)}
            onConfirm={() => void sendMessage("Confirmo y guardá estos cambios", false, { token: m.pendingConfirmationToken!, requestId: m.pendingConfirmationRequestId! })}
            onNavigate={navigate}
          />
        ))}
        {loading && <ChatThinking />}
        <div ref={endRef} />
      </div>

      {/* Docked above the mobile tab bar (AppShell reserves 4.5rem for it). */}
      <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 -mx-4 bg-background/95 px-4 pb-3 pt-2 backdrop-blur sm:-mx-6 sm:px-6 lg:bottom-0 lg:pb-6">
        <ChatComposer
          input={input}
          onInputChange={setInput}
          onSend={send}
          loading={loading}
          readOnly={actionReadOnly}
          recording={recording}
          recordingTime={recordingTime}
          onStartRecording={startRecording}
          onStopRecording={stopRecording}
          onCancelRecording={cancelRecording}
        />
      </div>
    </main>
  );
}
