"use client";

import { Mic, SendHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatRecordingTime } from "@/lib/chat-response";

interface ChatComposerProps {
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  loading: boolean;
  readOnly: boolean;
  recording: boolean;
  recordingTime: number;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onCancelRecording: () => void;
}

const shell = "flex items-center gap-2 rounded-lg border border-input bg-card p-1.5 shadow-xs transition-colors";

export function ChatComposer({
  input, onInputChange, onSend, loading, readOnly, recording, recordingTime, onStartRecording, onStopRecording, onCancelRecording,
}: ChatComposerProps) {
  if (recording) {
    return (
      <div className={shell}>
        <Button variant="ghost" size="icon-lg" onClick={onCancelRecording} aria-label="Cancelar grabación" title="Cancelar">
          <X aria-hidden="true" />
        </Button>
        <div className="flex min-w-0 flex-1 items-center gap-3 px-1">
          <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-bad" aria-hidden="true" />
          <span className="text-sm text-muted-foreground">Grabando</span>
          <span className="figure text-base font-semibold text-bad" role="timer" aria-label={`Tiempo de grabación ${formatRecordingTime(recordingTime)}`}>
            {formatRecordingTime(recordingTime)}
          </span>
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <div className="h-full rounded-full bg-bad-line" style={{ width: `${Math.min(recordingTime * 2, 100)}%` }} />
          </div>
        </div>
        <Button size="icon-lg" onClick={onStopRecording} aria-label="Enviar audio" title="Enviar audio">
          <SendHorizontal aria-hidden="true" />
        </Button>
      </div>
    );
  }

  const disabled = loading || readOnly;
  return (
    <div className="space-y-1.5">
      {readOnly && <p role="status" className="px-1 text-xs text-warn">El chat requiere conexión; estás en modo lectura.</p>}
      <div className={`${shell} focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 ${disabled ? "opacity-60" : ""}`}>
        <input
          type="text"
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onSend()}
          placeholder="Preguntá o cargá algo…"
          aria-label="Mensaje"
          disabled={disabled}
          className="min-w-0 flex-1 bg-transparent px-2.5 py-1.5 text-[15px] text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
        />
        {input.trim() ? (
          <Button onClick={onSend} disabled={disabled}>
            Enviar
            <SendHorizontal aria-hidden="true" />
          </Button>
        ) : (
          <Button variant="ghost" size="icon-lg" onClick={onStartRecording} disabled={disabled} aria-label="Grabar audio" title="Grabar audio" className="text-muted-foreground hover:text-foreground">
            <Mic aria-hidden="true" />
          </Button>
        )}
      </div>
    </div>
  );
}
