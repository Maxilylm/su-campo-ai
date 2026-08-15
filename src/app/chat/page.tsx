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
import { useOfflineAwareNavigation } from "@/lib/use-offline-aware-navigation";

// ─── Types ──────────────────────────────────

type ChatMessage = ChatMessageRecord;

// ─── Page Component ─────────────────────────

export default function ChatPage() {
  const { refreshSections, offlineMode, isOnline } = useFarm();
  const navigate = useOfflineAwareNavigation();
  const readOnly = offlineMode || !isOnline;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const endRef = useRef<HTMLDivElement>(null);
  const historyRequestId = useRef(0);
  const historyControllerRef = useRef<AbortController | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
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
    if (readOnly) {
      if (currentRequest === historyRequestId.current) {
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
      if (currentRequest === historyRequestId.current && !controller.signal.aborted && saved && saved.length > 0) {
        setMessages(saved.map((m: { role: string; content: string }) => ({
          role: m.role as "user" | "assistant",
          text: m.content,
        })));
      }
      if (currentRequest === historyRequestId.current && !controller.signal.aborted) setHistoryError(false);
    } catch {
      if (currentRequest === historyRequestId.current && !controller.signal.aborted) setHistoryError(true);
    } finally {
      if (currentRequest === historyRequestId.current && !controller.signal.aborted) setHistoryLoaded(true);
      if (historyControllerRef.current === controller) historyControllerRef.current = null;
    }
  }, [readOnly]);

  useEffect(() => {
    void loadHistory();
    return () => {
      historyRequestId.current += 1;
      historyControllerRef.current?.abort();
    };
  }, [loadHistory]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Cleanup recording timer
  useEffect(() => {
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
    if (!normalizedText || loading || readOnly) return;

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

    try {
      const res = await fetchWithTimeout("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": requestId },
        body: JSON.stringify({
          message: prepared.normalizedText,
          history: prepared.history,
        }),
      }, 27_000);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "No se pudo procesar el mensaje.");
      const operationMigration = typeof data.operationMigration === "string" ? data.operationMigration : undefined;
      setMessages((prev) => [...prev, {
        role: "assistant",
        text: data.response || data.error || "Sin respuesta",
        ...(operationMigration ? { failed: true, operationMigration } : {}),
      }]);
      if (data.intent === "update" || data.intent === "setup") {
        notifyDataChanged();
        onDataChange();
      }
    } catch (error) {
      const detail = error instanceof Error && !/abort|fetch failed|failed to fetch/i.test(error.message)
        ? error.message
        : "No pude conectar con CampoAI. Intentá nuevamente.";
      setMessages((prev) => [...prev, { role: "assistant", text: detail, failed: true, retryText: normalizedText, retryRequestId: requestId }]);
    } finally {
      setLoading(false);
    }
  }

  function send() {
    if (readOnly) return;
    void sendMessage(input);
  }

  async function startRecording() {
    if (readOnly || loading) return;
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
        if (readOnly || !navigator.onLine) {
          setMessages((prev) => [...prev, { role: "assistant", text: "El audio no se envió porque no hay conexión.", failed: true }]);
          return;
        }

        // Show user message
        setMessages((prev) => [...prev, { role: "user", text: "🎤 Enviando audio..." }]);
        setLoading(true);

        const requestId = crypto.randomUUID();
        try {
          const formData = new FormData();
          formData.append("audio", audioBlob, "recording.webm");
          formData.append("history", JSON.stringify(messages.slice(-20)));

          const res = await fetchWithTimeout("/api/chat/audio", { method: "POST", headers: { "Idempotency-Key": requestId }, body: formData }, 30_000);
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "No se pudo procesar el audio.");

          // Replace the "Enviando audio..." with the transcription
          const operationMigration = typeof data.operationMigration === "string" ? data.operationMigration : undefined;
          setMessages((prev) => {
            const updated = [...prev];
            const lastUserIdx = updated.findLastIndex((m) => m.role === "user");
            if (lastUserIdx >= 0) {
              updated[lastUserIdx] = { role: "user", text: `🎤 ${data.transcription || "Audio"}` };
            }
            return [...updated, {
              role: "assistant",
              text: data.response || data.error || "Sin respuesta",
              ...(operationMigration ? { failed: true, operationMigration } : {}),
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
          setMessages((prev) => [...prev, { role: "assistant", text: detail, failed: true, retryText: "🎤 Reintentar audio", retryRequestId: requestId }]);
        } finally {
          setLoading(false);
        }
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
    if (readOnly) return;
    const result = await sendJsonResult("/api/chat", "DELETE");
    if (result.ok) {
      setMessages([]);
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
                <button type="button" disabled={readOnly} className="text-xs text-muted-foreground hover:text-destructive transition-colors disabled:cursor-not-allowed disabled:opacity-50">
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
          {messages.length === 0 && (
            <div className="py-4">
              <EmptyState
                icon={MessageSquare}
                title="Habla con CampoAI"
                description="Envia mensajes en lenguaje natural para gestionar tu campo"
              />
              <div className="flex flex-wrap gap-2 justify-center max-w-md mx-auto mt-4">
                {["Agregar potrero Sur de 60 ha", "Registrar 20 vacas Angus en Norte", "¿Cuantas cabezas hay?", "Mover 10 terneros al Sur"].map((s) => (
                  <Button key={s} variant="outline" size="sm" onClick={() => setInput(s)}>
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
                {m.failed && m.retryText && !m.retryText.startsWith("🎤") && <button type="button" onClick={() => void sendMessage(m.retryText || "", true)} disabled={loading || readOnly} className="mt-2 block font-medium text-primary hover:underline disabled:opacity-50">Reintentar</button>}
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
              {readOnly && <p role="status" className="px-1 text-xs text-amber-600 dark:text-amber-400">El chat requiere conexión; estás en modo lectura.</p>}
              <div className="flex gap-2">
                <input type="text" value={input} onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && send()}
                  placeholder="Escribi un mensaje..."
                  disabled={loading || readOnly}
                  className="flex-1 rounded-xl border border-border bg-muted/50 px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/40 disabled:opacity-40" />
                {input.trim() ? (
                  <button type="button" onClick={send} disabled={loading || readOnly}
                    className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors">
                    Enviar
                  </button>
                ) : (
                  <button type="button" onClick={startRecording} disabled={loading || readOnly}
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
