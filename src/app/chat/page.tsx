"use client";

import { useState, useEffect, useRef } from "react";
import { useFarm } from "@/contexts/FarmContext";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MessageSquare, Bot, Mic } from "lucide-react";

// ─── Types ──────────────────────────────────

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}

// ─── Page Component ─────────────────────────

export default function ChatPage() {
  const { refreshSections } = useFarm();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const endRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load chat history on mount
  useEffect(() => {
    async function loadHistory() {
      try {
        const res = await fetch("/api/chat");
        if (res.ok) {
          const { messages: saved } = await res.json();
          if (saved && saved.length > 0) {
            setMessages(saved.map((m: { role: string; content: string }) => ({
              role: m.role as "user" | "assistant",
              text: m.content,
            })));
          }
        }
      } catch {
        // Ignore — fresh chat
      }
      setHistoryLoaded(true);
    }
    loadHistory();
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Cleanup recording timer
  useEffect(() => {
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  async function onDataChange() {
    await refreshSections();
  }

  async function send() {
    if (!input.trim() || loading) return;
    const text = input;
    setMessages((prev) => [...prev, { role: "user", text }]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          history: messages.slice(-20),
        }),
      });
      const data = await res.json();
      setMessages((prev) => [...prev, { role: "assistant", text: data.response || data.error || "Sin respuesta" }]);
      if (data.intent === "update" || data.intent === "setup") {
        onDataChange();
      }
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", text: "Error de conexion." }]);
    } finally {
      setLoading(false);
    }
  }

  async function startRecording() {
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
        setRecordingTime(0);

        const audioBlob = new Blob(chunksRef.current, { type: mimeType });
        if (audioBlob.size < 1000) return; // too short, ignore

        // Show user message
        setMessages((prev) => [...prev, { role: "user", text: "🎤 Enviando audio..." }]);
        setLoading(true);

        try {
          const formData = new FormData();
          formData.append("audio", audioBlob, "recording.webm");
          formData.append("history", JSON.stringify(messages.slice(-20)));

          const res = await fetch("/api/chat/audio", { method: "POST", body: formData });
          const data = await res.json();

          // Replace the "Enviando audio..." with the transcription
          setMessages((prev) => {
            const updated = [...prev];
            const lastUserIdx = updated.findLastIndex((m) => m.role === "user");
            if (lastUserIdx >= 0) {
              updated[lastUserIdx] = { role: "user", text: `🎤 ${data.transcription || "Audio"}` };
            }
            return [...updated, { role: "assistant", text: data.response || data.error || "Sin respuesta" }];
          });

          if (data.intent === "update" || data.intent === "setup") {
            onDataChange();
          }
        } catch {
          setMessages((prev) => [...prev, { role: "assistant", text: "Error procesando audio." }]);
        } finally {
          setLoading(false);
        }
      };

      mediaRecorder.start(250); // collect in 250ms chunks
      mediaRecorderRef.current = mediaRecorder;
      setRecording(true);
      setRecordingTime(0);
      timerRef.current = setInterval(() => setRecordingTime((t) => t + 1), 1000);
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
    setRecording(false);
    setRecordingTime(0);
  }

  async function clearHistory() {
    await fetch("/api/chat", { method: "DELETE" });
    setMessages([]);
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
            <button onClick={clearHistory} className="text-xs text-muted-foreground hover:text-destructive transition-colors">
              Limpiar historial
            </button>
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
                m.role === "user" ? "bg-emerald-600 text-white rounded-br-md" : "bg-muted text-foreground rounded-bl-md"
              }`}>
                {m.text}
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
              <button onClick={cancelRecording}
                className="p-2.5 rounded-xl bg-muted hover:bg-accent text-muted-foreground transition-colors" title="Cancelar">
                ✕
              </button>
              <div className="flex-1 flex items-center gap-3">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
                <span className="text-sm text-red-400 tabular-nums font-mono">{formatTime(recordingTime)}</span>
                <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
                  <div className="h-full bg-red-500/60 rounded-full animate-pulse" style={{ width: `${Math.min(recordingTime * 2, 100)}%` }} />
                </div>
              </div>
              <button onClick={stopRecording}
                className="p-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white transition-colors" title="Enviar audio">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            </div>
          ) : (
            /* Normal input */
            <div className="flex gap-2">
              <input type="text" value={input} onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send()}
                placeholder="Escribi un mensaje..."
                disabled={loading}
                className="flex-1 rounded-xl border border-border bg-muted/50 px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/40 disabled:opacity-40" />
              {input.trim() ? (
                <button onClick={send} disabled={loading}
                  className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors">
                  Enviar
                </button>
              ) : (
                <button onClick={startRecording} disabled={loading}
                  className="px-4 py-2.5 rounded-xl bg-muted hover:bg-accent border border-border text-muted-foreground hover:text-emerald-400 disabled:opacity-40 transition-colors"
                  title="Grabar audio">
                  <Mic className="h-[18px] w-[18px]" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
