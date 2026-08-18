"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useFarm } from "@/contexts/FarmContext";
import { EmptyState } from "@/components/EmptyState";
import { LoadErrorState } from "@/components/LoadErrorState";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MessageSquare, Bot, Mic } from "lucide-react";
import { toast } from "sonner";
import { notifyDataChanged, sendJsonResult } from "@/lib/mutate";
import { fetchWithTimeout } from "@/lib/fetch";
import { prepareChatRequest, type ChatMessageRecord } from "@/lib/chat";
import { isOfflineSnapshotFresh, offlineChatSnapshotKey, parseOfflineChatSnapshot } from "@/lib/offline";
import { useOfflineAwareNavigation } from "@/lib/use-offline-aware-navigation";
import { aiChatHandoffKey, aiInsightsHandoffKey } from "@/lib/ai-handoff";
import { AI_CONTEXT_UNAVAILABLE_CODE } from "@/lib/ai-errors";

// ─── Types ──────────────────────────────────

type ChatMessage = ChatMessageRecord;
const MAX_AUDIO_RETRY_PAYLOADS = 3;

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
  const actionReadOnly = offlineReadOnly || permissionReadOnly;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const [chatSnapshotSavedAt, setChatSnapshotSavedAt] = useState<string | null>(null);
  const [historyUserId, setHistoryUserId] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const endRef = useRef<HTMLDivElement>(null);
  const historyRequestId = useRef(0);
  const historyControllerRef = useRef<AbortController | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioRetryStoreRef = useRef(new Map<string, { blob: Blob; mimeType: string }>());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const maxRecordingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load chat history when connectivity is available. Chat history is not part
  // of the offline snapshot, so a disconnected session should show the chat
  // shell in read-only mode instead of a misleading load error.
  const loadHistory = useCallback(async () => {
    const currentRequest = ++historyRequestId.current;
    historyControllerRef.current?.abort();
    const controller = new AbortController();
    historyControllerRef.current = controller;
    if (currentRequest === historyRequestId.current) {
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
    if (currentRequest === historyRequestId.current) {
      setHistoryLoaded(false);
      setHistoryError(false);
    }
    try {
      const res = await fetchWithTimeout("/api/chat", { signal: controller.signal }, 8000);
      if (!res.ok) throw new Error("chat history request failed");
      const { messages: saved } = await res.json();
      if (currentRequest === historyRequestId.current && !controller.signal.aborted && Array.isArray(saved)) {
        setMessages(saved.map((m: { role: string; content: string }) => ({
          role: m.role as "user" | "assistant",
          text: m.content,
        })));
        setChatSnapshotSavedAt(null);
        setHistoryUserId(userId);
      }
      if (currentRequest === historyRequestId.current && !controller.signal.aborted) setHistoryError(false);
    } catch {
      if (currentRequest === historyRequestId.current && !controller.signal.aborted) {
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
      if (currentRequest === historyRequestId.current && !controller.signal.aborted) setHistoryLoaded(true);
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

  // An insight can hand its exact generated context into Chat without putting
  // farm data in the URL. The handoff is one-time and scoped to this user.
  useEffect(() => {
    if (!userId || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const fromInsights = params.get("from") === "insights";
    const fromOperationalCard = params.get("from") === "alerts" || params.get("from") === "agenda";
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

  // Cleanup recording timer
  useEffect(() => {
    const audioRetryStore = audioRetryStoreRef.current;
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (maxRecordingTimerRef.current) clearTimeout(maxRecordingTimerRef.current);
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.ondataavailable = null;
        recorder.onstop = () => recorder.stream.getTracks().forEach((track) => track.stop());
        recorder.stop();
      } else {
        recorder?.stream.getTracks().forEach((track) => track.stop());
      }
      mediaRecorderRef.current = null;
      audioRetryStore.clear();
    };
  }, []);

  async function onDataChange() {
    try {
      await refreshSections();
    } catch {
      // The AI response already succeeded; a stale section list is recoverable
      // through the shared refresh flow and must not become an unhandled error.
    }
  }

  async function sendMessage(text: string, retrying = false) {
    const normalizedText = text.trim();
    if (!normalizedText || loading || actionReadOnly) return;

    const lastMessage = messages[messages.length - 1];
    const requestId = retrying
      && lastMessage?.failed
      && lastMessage.retryText === normalizedText
      && lastMessage.retryRequestId
      ? lastMessage.retryRequestId
      : crypto.randomUUID();
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
        }),
      }, 27_000);
      const data = await res.json().catch(() => ({}));
      contextUnavailable = data.code === AI_CONTEXT_UNAVAILABLE_CODE;
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "No se pudo procesar el mensaje.");
      const operationMigration = typeof data.operationMigration === "string" ? data.operationMigration : undefined;
      const changeLinks = Array.isArray(data.changeLinks)
        ? data.changeLinks.filter((link: { label?: unknown; href?: unknown }) => typeof link.label === "string" && typeof link.href === "string")
        : undefined;
      setMessages((prev) => [...prev, {
        role: "assistant",
        text: data.response || data.error || "Sin respuesta",
        ...(operationMigration ? { failed: true, operationMigration } : {}),
        ...(changeLinks?.length ? { changeLinks } : {}),
      }]);
      if (data.intent === "update" || data.intent === "setup") {
        notifyDataChanged();
        onDataChange();
      }
    } catch (error) {
      const detail = error instanceof Error && !/abort|fetch failed|failed to fetch/i.test(error.message)
        ? error.message
        : "No pude conectar con CampoAI. Intentá nuevamente.";
      setMessages((prev) => [...prev, { role: "assistant", text: detail, failed: true, retryText: normalizedText, retryRequestId: requestId, ...(contextUnavailable ? { aiContextUnavailable: true } : {}) }]);
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
        return [...prev, { role: "user", text: "🎤 Enviando audio...", audioRequestId: requestId }];
      }
      const updated = [...prev];
      updated[existingUserIdx] = { role: "user", text: "🎤 Reintentando audio...", audioRequestId: requestId };
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
      const operationMigration = typeof data.operationMigration === "string" ? data.operationMigration : undefined;
      const changeLinks = Array.isArray(data.changeLinks)
        ? data.changeLinks.filter((link: { label?: unknown; href?: unknown }) => typeof link.label === "string" && typeof link.href === "string")
        : undefined;
      setMessages((prev) => {
        const updated = [...prev];
        const lastUserIdx = updated.findLastIndex((message) => message.role === "user" && message.audioRequestId === requestId);
        if (lastUserIdx >= 0) {
          updated[lastUserIdx] = { role: "user", text: `🎤 ${data.transcription || "Audio"}` };
        }
        return [...updated, {
          role: "assistant",
          text: data.response || data.error || "Sin respuesta",
          ...(operationMigration ? { failed: true, operationMigration } : {}),
          ...(changeLinks?.length ? { changeLinks } : {}),
        }];
      });

      if (data.intent === "update" || data.intent === "setup") {
        notifyDataChanged();
        onDataChange();
      }
    } catch (error) {
      const detail = error instanceof Error && !/abort|fetch failed|failed to fetch/i.test(error.message)
        ? error.message
        : "No pude conectar con CampoAI. Intentá nuevamente.";
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

  async function startRecording() {
    if (actionReadOnly || loading) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        if (maxRecordingTimerRef.current) { clearTimeout(maxRecordingTimerRef.current); maxRecordingTimerRef.current = null; }
        setRecordingTime(0);

        const audioBlob = new Blob(chunksRef.current, { type: mimeType });
        if (audioBlob.size < 1000) return; // too short, ignore
        if (actionReadOnly || !navigator.onLine) {
          setMessages((prev) => [...prev, { role: "assistant", text: permissionReadOnly ? "El audio no se envió porque tu acceso es de solo lectura." : "El audio no se envió porque no hay conexión.", failed: true }]);
          return;
        }

        void sendAudio(audioBlob, mimeType);
      };

      mediaRecorder.start(250); // collect in 250ms chunks
      mediaRecorderRef.current = mediaRecorder;
      setRecording(true);
      setRecordingTime(0);
      timerRef.current = setInterval(() => setRecordingTime((t) => t + 1), 1000);
      maxRecordingTimerRef.current = setTimeout(() => {
        if (mediaRecorderRef.current?.state === "recording") stopRecording();
      }, 120_000);
    } catch {
      // Microphone not available
      setMessages((prev) => [...prev, { role: "assistant", text: "No se pudo acceder al microfono. Verifica los permisos del navegador." }]);
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setRecording(false);
  }

  function cancelRecording() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.ondataavailable = null;
      mediaRecorderRef.current.onstop = () => {
        mediaRecorderRef.current?.stream.getTracks().forEach((t) => t.stop());
      };
      mediaRecorderRef.current.stop();
    }
    chunksRef.current = [];
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (maxRecordingTimerRef.current) { clearTimeout(maxRecordingTimerRef.current); maxRecordingTimerRef.current = null; }
    setRecording(false);
    setRecordingTime(0);
  }

  async function clearHistory() {
    if (actionReadOnly) return;
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

  function formatTime(s: number) {
    return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
  }

  if (!historyLoaded) {
    return (
      <main className="flex-1 w-full max-w-4xl mx-auto px-4 py-6">
        <div className="rounded-2xl border border-border bg-card py-12 px-4">
          <div className="space-y-3 max-w-md mx-auto">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        </div>
      </main>
    );
  }

  if (historyError) {
    return <main className="flex-1 w-full max-w-4xl mx-auto px-4 py-6"><LoadErrorState title="No se pudo cargar el chat" onRetry={() => void loadHistory()} /></main>;
  }

  return (
    <main className="flex-1 w-full max-w-4xl mx-auto px-4 py-6">
      <div className="flex flex-col rounded-2xl border border-border bg-card overflow-hidden" style={{ height: "min(520px, 70vh)" }}>
        {/* Chat header — shown when there are messages */}
        {messages.length > 0 && (
          <div className="flex items-center justify-between px-4 py-2 border-b border-border">
            <div className="flex items-center gap-2">
              <Bot className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground">Chat con CampoAI</span>
              <span className="text-xs text-muted-foreground ml-2">{messages.length} mensajes</span>
            </div>
            <ConfirmDialog
              trigger={
                <button type="button" disabled={actionReadOnly} className="text-xs text-muted-foreground hover:text-destructive transition-colors disabled:cursor-not-allowed disabled:opacity-50">
                  Limpiar historial
                </button>
              }
              title="¿Borrar el historial?"
              description="Se eliminarán todos los mensajes de esta conversación. Esta acción no se puede deshacer."
              confirmLabel="Borrar"
              onConfirm={clearHistory}
            />
          </div>
        )}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {chatSnapshotSavedAt && <div role="status" className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground">{offlineReadOnly ? "Sin conexión: mostrando el historial guardado" : "No se pudo actualizar el historial: mostrando la última copia guardada"} del {new Date(chatSnapshotSavedAt).toLocaleString("es-UY")}.</div>}
          {messages.length === 0 && (
            <div className="py-4">
              <EmptyState
                icon={MessageSquare}
                title="Habla con CampoAI"
                description="Envia mensajes en lenguaje natural para gestionar tu campo"
              />
              <div className="flex flex-wrap gap-2 justify-center max-w-md mx-auto mt-4">
                {["Agregar potrero Sur de 60 ha", "Registrar 20 vacas Angus en Norte", "¿Cuantas cabezas hay?", "Mover 10 terneros al Sur"].map((s) => (
                  <Button key={s} variant="outline" size="sm" onClick={() => setInput(s)} disabled={actionReadOnly}>
                    {s}
                  </Button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                m.role === "user" ? "bg-emerald-600 text-white rounded-br-md" : m.failed ? "bg-amber-500/10 text-amber-700 dark:text-amber-300 rounded-bl-md" : "bg-muted text-foreground rounded-bl-md"
              }`}>
                {m.text}
                {m.failed && m.retryText && (m.audioRetry || !m.retryText.startsWith("🎤")) && <button type="button" onClick={() => m.audioRetry && m.retryRequestId ? retryAudio(m.retryRequestId) : void sendMessage(m.retryText || "", true)} disabled={loading || actionReadOnly || Boolean(m.audioRetry && (!m.retryRequestId || !audioRetryStoreRef.current.has(m.retryRequestId)))} className="mt-2 block font-medium text-primary hover:underline disabled:opacity-50">{m.audioRetry ? "Reintentar audio" : "Reintentar"}</button>}
                {m.aiContextUnavailable && <button type="button" onClick={() => navigate("/gestion/campo")} className="mt-2 block font-medium text-primary hover:underline">Abrir diagnóstico de servicios</button>}
                {m.changeLinks && m.changeLinks.length > 0 && <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">{m.changeLinks.map((link) => <button key={link.href} type="button" onClick={() => navigate(link.href)} className="font-medium text-primary hover:underline">Ver {link.label}</button>)}</div>}
                {m.operationMigration && <button type="button" onClick={() => navigate("/gestion/campo")} className="mt-2 block font-medium text-primary hover:underline">Abrir diagnóstico</button>}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-muted rounded-2xl rounded-bl-md px-4 py-2.5">
                <Skeleton className="h-4 w-24" />
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        {/* Input bar */}
        <div className="border-t border-border p-3">
          {recording ? (
            /* Recording UI */
            <div className="flex items-center gap-3">
              <button type="button" onClick={cancelRecording}
                className="p-2.5 rounded-xl bg-muted hover:bg-accent text-muted-foreground transition-colors" title="Cancelar">
                ✕
              </button>
              <div className="flex-1 flex items-center gap-3">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" aria-hidden="true" />
                <span className="sr-only">Grabando</span>
                <span className="text-sm text-red-400 tabular-nums font-mono">{formatTime(recordingTime)}</span>
                <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
                  <div className="h-full bg-red-500/60 rounded-full animate-pulse" style={{ width: `${Math.min(recordingTime * 2, 100)}%` }} />
                </div>
              </div>
              <button type="button" onClick={stopRecording}
                className="p-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white transition-colors" title="Enviar audio">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            </div>
          ) : (
            /* Normal input */
            <div className="space-y-2">
              {actionReadOnly && <p role="status" className={`px-1 text-xs ${permissionReadOnly ? "text-sky-700 dark:text-sky-300" : "text-amber-600 dark:text-amber-400"}`}>{permissionReadOnly ? "Tu acceso es de solo lectura; podés consultar el historial, pero no enviar mensajes." : "El chat requiere conexión; estás en modo lectura."}</p>}
              <div className="flex gap-2">
                <input type="text" value={input} onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && send()}
                  placeholder="Escribi un mensaje..."
                  disabled={loading || actionReadOnly}
                  className="flex-1 rounded-xl border border-border bg-muted/50 px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/40 disabled:opacity-40" />
                {input.trim() ? (
                  <button type="button" onClick={send} disabled={loading || actionReadOnly}
                    className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors">
                    Enviar
                  </button>
                ) : (
                  <button type="button" onClick={startRecording} disabled={loading || actionReadOnly}
                    className="px-4 py-2.5 rounded-xl bg-muted hover:bg-accent border border-border text-muted-foreground hover:text-emerald-400 disabled:opacity-40 transition-colors"
                    title="Grabar audio">
                    <Mic className="h-[18px] w-[18px]" />
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
