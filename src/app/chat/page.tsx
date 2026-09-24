"use client";

import { useState, useEffect, useRef } from "react";
import { MessagesSquare, SquarePen } from "lucide-react";
import { useFarm } from "@/contexts/FarmContext";
import { PageHeader } from "@/components/PageHeader";
import { ChatComposer } from "@/components/chat/ChatComposer";
import { ChatEmptyState } from "@/components/chat/ChatEmptyState";
import { ChatHistorySkeleton } from "@/components/chat/ChatHistorySkeleton";
import { ChatMessageItem, ChatThinking } from "@/components/chat/ChatMessageItem";
import { ConversationList } from "@/components/chat/ConversationList";
import { DeleteConversationDialog, RenameConversationDialog } from "@/components/chat/ConversationDialogs";
import { useChatConversations } from "@/components/chat/useChatConversations";
import { useChatHistory } from "@/components/chat/useChatHistory";
import { useVoiceRecorder } from "@/components/chat/useVoiceRecorder";
import { LoadErrorState } from "@/components/LoadErrorState";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { toast } from "sonner";
import { notifyDataChanged, sendJsonResult } from "@/lib/mutate";
import { fetchWithTimeout } from "@/lib/fetch";
import { prepareChatRequest } from "@/lib/chat";
import { useOfflineAwareNavigation } from "@/lib/use-offline-aware-navigation";
import { isChatHandoffUrl, useChatHandoff } from "@/components/chat/useChatHandoff";
import { assistantMessageFromResponse, chatFailureText, responseHasPendingConfirmation } from "@/lib/chat-response";
import { AI_CONTEXT_UNAVAILABLE_CODE } from "@/lib/ai-errors";
import { isExplicitAIConfirmation } from "@/lib/ai-confirmation-text";
import { CONVERSATION_PARAM, conversationHref, normalizeConversationId, type ChatConversationSummary } from "@/lib/chat-conversations";

const MAX_AUDIO_RETRY_PAYLOADS = 3;
const CHAT_HISTORY_POLL_MS = 30_000;

// ─── Page Component ─────────────────────────

export default function ChatPage() {
  const { refreshSections, userId, offlineMode, isOnline, readOnly: permissionReadOnly } = useFarm();
  const navigate = useOfflineAwareNavigation();
  const offlineReadOnly = offlineMode || !isOnline;
  const actionReadOnly = offlineReadOnly;
  const historyWriteReadOnly = offlineReadOnly || permissionReadOnly;
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const audioRetryStoreRef = useRef(new Map<string, { blob: Blob; mimeType: string }>());

  // Conversations (migration 052). The active one lives in the URL (?c=<id>);
  // null is a new conversation, saved with its first message. When the list
  // is unavailable (052 not applied, or offline) the page is the single
  // shared thread of older releases and the list is hidden.
  const conversations = useChatConversations();
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeIdRef = useRef<string | null>(null);
  // Bumped on every conversation switch; a response that arrives after the
  // user moved to another conversation must not render into it.
  const viewRef = useRef(0);
  const [routeReady, setRouteReady] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<ChatConversationSummary | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ChatConversationSummary | null>(null);
  const conversationMode = !offlineReadOnly && (conversations.status === "ready" || conversations.status === "error");
  const listPending = !offlineReadOnly && (conversations.status === "idle" || conversations.status === "loading");
  const activeConversation = activeId
    ? conversations.items.find((item) => item.id === activeId) ?? { id: activeId, title: "Esta conversación", channel: "web" as const, created_by: null, created_at: "", updated_at: "" }
    : null;

  const { load: loadConversations } = conversations;
  useEffect(() => {
    if (offlineReadOnly) return;
    void loadConversations();
  }, [loadConversations, offlineReadOnly, userId]);

  const { messages, setMessages, historyLoaded, historyError, chatSnapshotSavedAt, loadHistory, cancelHistory, forgetChatSnapshot } = useChatHistory({
    offlineReadOnly,
    userId,
    conversationMode,
    listPending,
    loading,
    onMissingConversation: (id) => {
      toast.error("Esa conversación ya no existe. Empezá una nueva.");
      conversations.forget(id);
      openConversation(null, "replace");
    },
  });

  /** Switch the chat to a conversation (null = new) and put it in the URL. */
  function openConversation(id: string | null, historyMode: "push" | "replace" | "none" = "push") {
    viewRef.current += 1;
    activeIdRef.current = id;
    setActiveId(id);
    setListOpen(false);
    if (historyMode !== "none") {
      const href = conversationHref(window.location.pathname, window.location.search, id);
      if (historyMode === "push") window.history.pushState(null, "", href);
      else window.history.replaceState(null, "", href);
    }
    void loadHistory({ conversationId: id });
  }

  // The URL decides the first conversation; back/forward move between them.
  // A handoff from another page (?from=…) always starts a new conversation.
  const loadHistoryRef = useRef(loadHistory);
  useEffect(() => {
    loadHistoryRef.current = loadHistory;
  }, [loadHistory]);
  useEffect(() => {
    const readUrl = () => isChatHandoffUrl(window.location.search)
      ? null
      : normalizeConversationId(new URLSearchParams(window.location.search).get(CONVERSATION_PARAM));
    const initial = readUrl();
    activeIdRef.current = initial;
    setActiveId(initial);
    setRouteReady(true);
    const onPopState = () => {
      const id = readUrl();
      if (id === activeIdRef.current) return;
      viewRef.current += 1;
      activeIdRef.current = id;
      setActiveId(id);
      void loadHistoryRef.current({ conversationId: id });
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (!routeReady) return;
    void loadHistory({ conversationId: activeIdRef.current });
    return cancelHistory;
  }, [cancelHistory, loadHistory, routeReady]);

  // WhatsApp and other members can append to a conversation (or start new
  // ones) without a local browser event. Keep an open Chat current while
  // avoiding visible loading states or interference with an in-flight request.
  useEffect(() => {
    if (offlineReadOnly || !userId) return;
    const timer = setInterval(() => {
      if (loading) return;
      void loadHistory({ silent: true, conversationId: activeIdRef.current });
      if (conversationMode) void loadConversations({ silent: true });
    }, CHAT_HISTORY_POLL_MS);
    return () => clearInterval(timer);
  }, [conversationMode, loadConversations, loadHistory, loading, offlineReadOnly, userId]);

  useChatHandoff(userId, setInput);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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

  /** The server saved the turn to a conversation (a new one gets its id and
   * title here): make it the active one and move it to the top of the list. */
  function adoptConversation(data: { conversationId?: unknown; conversationTitle?: unknown }) {
    if (!conversationMode || typeof data.conversationId !== "string") return;
    const id = data.conversationId;
    if (activeIdRef.current !== id) {
      activeIdRef.current = id;
      setActiveId(id);
      window.history.replaceState(null, "", conversationHref(window.location.pathname, window.location.search, id));
    }
    conversations.touch({ id, ...(typeof data.conversationTitle === "string" ? { title: data.conversationTitle } : {}) });
  }

  /** A response for a conversation the user already left: keep the list and
   * other screens current, but don't touch the conversation now on screen. */
  function settleStaleResponse(data: { conversationId?: unknown; conversationTitle?: unknown; intent?: unknown }) {
    if (conversationMode && typeof data.conversationId === "string") {
      conversations.touch({ id: data.conversationId, ...(typeof data.conversationTitle === "string" ? { title: data.conversationTitle } : {}) });
    }
    if (data.intent === "update" || data.intent === "setup") {
      notifyDataChanged();
      onDataChange();
    }
  }

  /** conversationId for a chat request: null starts a new one; omitted before 052. */
  function conversationField(): { conversationId: string | null } | Record<string, never> {
    return conversationMode ? { conversationId: activeIdRef.current } : {};
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
    const view = viewRef.current;
    try {
      const res = await fetchWithTimeout("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": requestId },
        body: JSON.stringify({
          message: prepared.normalizedText,
          ...conversationField(),
          ...(pendingConfirmation ? { confirmationToken: pendingConfirmation.token } : {}),
        }),
      }, 27_000);
      const data = await res.json().catch(() => ({}));
      if (viewRef.current !== view) {
        if (res.ok) settleStaleResponse(data);
        return;
      }
      contextUnavailable = data.code === AI_CONTEXT_UNAVAILABLE_CODE;
      adoptConversation(data);
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
      if (viewRef.current !== view) return;
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
    const view = viewRef.current;
    try {
      const formData = new FormData();
      formData.append("audio", audioBlob, "recording.webm");
      if (conversationMode) formData.append("conversationId", activeIdRef.current ?? "");

      const res = await fetchWithTimeout("/api/chat/audio", { method: "POST", headers: { "Idempotency-Key": requestId }, body: formData }, 27_000);
      const data = await res.json().catch(() => ({}));
      if (viewRef.current !== view) {
        if (res.ok) { audioRetryStoreRef.current.delete(requestId); settleStaleResponse(data); }
        return;
      }
      contextUnavailable = data.code === AI_CONTEXT_UNAVAILABLE_CODE;
      adoptConversation(data);
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
      if (viewRef.current !== view) return;
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

  // Single shared thread (052 not applied): clears the farm's whole history.
  async function clearHistory() {
    if (historyWriteReadOnly) return;
    const result = await sendJsonResult("/api/chat", "DELETE");
    if (result.ok) {
      setMessages([]);
      forgetChatSnapshot();
      toast.success("Historial borrado");
    } else {
      toast.error(result.error || "No se pudo borrar el historial");
    }
  }

  async function deleteConversation(id: string): Promise<boolean> {
    if (historyWriteReadOnly) return false;
    const result = await conversations.remove(id);
    if (!result.ok && result.status !== 404) {
      toast.error(result.error || "No se pudo eliminar la conversación. Intentá nuevamente.");
      return false;
    }
    toast.success("Conversación eliminada");
    if (activeIdRef.current === id) {
      forgetChatSnapshot();
      openConversation(null, "replace");
    }
    return true;
  }

  async function renameConversation(id: string, title: string): Promise<boolean> {
    const result = await conversations.rename(id, title);
    if (!result.ok) toast.error(result.error || "No se pudo renombrar la conversación. Intentá nuevamente.");
    return result.ok;
  }

  const list = (
    <ConversationList
      status={conversations.status}
      conversations={conversations.items}
      activeId={activeId}
      disabled={loading}
      canManage={conversations.canManage && !historyWriteReadOnly}
      userId={conversations.userId}
      hasMore={Boolean(conversations.nextCursor)}
      loadingMore={conversations.loadingMore}
      onSelect={(id) => { if (id !== activeIdRef.current) openConversation(id); else setListOpen(false); }}
      onNew={() => openConversation(null)}
      onRename={setRenameTarget}
      onDelete={setDeleteTarget}
      onLoadMore={() => void conversations.loadMore()}
      onRetry={() => void loadConversations()}
    />
  );

  const headerActions = conversationMode ? (
    <>
      <Button variant="outline" size="sm" className="lg:hidden" onClick={() => setListOpen(true)}>
        <MessagesSquare aria-hidden="true" />
        Conversaciones
      </Button>
      <Button variant="ghost" size="sm" className="lg:hidden" onClick={() => openConversation(null)} disabled={loading || !activeId}>
        <SquarePen aria-hidden="true" />
        Nueva
      </Button>
      {activeConversation && conversations.canManage && (
        <Button variant="ghost" size="sm" disabled={historyWriteReadOnly || loading} className="text-muted-foreground" onClick={() => setDeleteTarget(activeConversation)}>
          Eliminar conversación
        </Button>
      )}
    </>
  ) : messages.length > 0 ? (
    <ConfirmDialog
      trigger={<Button variant="ghost" size="sm" disabled={historyWriteReadOnly} className="text-muted-foreground">Borrar historial</Button>}
      title="¿Borrar el historial?"
      description="Se eliminarán todos los mensajes de esta conversación. Esta acción no se puede deshacer."
      confirmLabel="Borrar"
      onConfirm={clearHistory}
    />
  ) : undefined;

  let body: React.ReactNode;
  if (!historyLoaded || (listPending && !historyError)) {
    body = <ChatHistorySkeleton />;
  } else if (historyError) {
    body = <LoadErrorState title="No se pudo cargar el chat" onRetry={() => void loadHistory({ conversationId: activeIdRef.current })} />;
  } else {
    body = (
      <>
        <PageHeader
          title="CampoAI"
          description={conversationMode
            ? (activeConversation?.title ?? "Nueva conversación")
            : "Tu asistente del campo: preguntá o cargá datos por texto o por audio."}
          actions={headerActions}
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
        <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 -mx-4 bg-background/95 px-4 pb-3 pt-2 backdrop-blur sm:-mx-6 sm:px-6 lg:bottom-0 lg:mx-0 lg:px-0 lg:pb-6">
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
      </>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 px-4 sm:px-6">
      {conversationMode && (
        <aside aria-label="Conversaciones anteriores" className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col self-start border-r border-border py-8 pr-4 lg:flex">
          {list}
        </aside>
      )}
      <div className={`mx-auto flex w-full min-w-0 max-w-3xl flex-1 flex-col pt-6 lg:pt-8 ${conversationMode ? "lg:pl-8" : ""}`}>
        {body}
      </div>

      {conversationMode && (
        <Sheet open={listOpen} onOpenChange={setListOpen}>
          <SheetContent side="left" className="w-[85vw] max-w-xs gap-0 p-0">
            <SheetHeader className="border-b border-border">
              <SheetTitle>Conversaciones</SheetTitle>
              <SheetDescription className="sr-only">Elegí una conversación anterior o empezá una nueva.</SheetDescription>
            </SheetHeader>
            <div className="flex min-h-0 flex-1 flex-col p-4">{list}</div>
          </SheetContent>
        </Sheet>
      )}
      <RenameConversationDialog conversation={renameTarget} onClose={() => setRenameTarget(null)} onRename={renameConversation} />
      <DeleteConversationDialog conversation={deleteTarget} onClose={() => setDeleteTarget(null)} onDelete={deleteConversation} />
    </main>
  );
}
