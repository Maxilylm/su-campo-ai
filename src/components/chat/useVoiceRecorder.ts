"use client";

import { useEffect, useRef, useState } from "react";

const MAX_RECORDING_MS = 120_000;

interface VoiceRecorderOptions {
  /** Recording cannot start (read-only or a request in flight). */
  disabled: boolean;
  /** A finished clip long enough to send. */
  onRecorded: (audioBlob: Blob, mimeType: string) => void;
  /** Microphone missing or permission denied. */
  onUnavailable: () => void;
}

/** MediaRecorder lifecycle for the Chat voice button: start, stop (send), cancel, 2-minute cap. */
export function useVoiceRecorder({ disabled, onRecorded, onUnavailable }: VoiceRecorderOptions) {
  const [recording, setRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const maxRecordingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Release the microphone and timers when the page unmounts mid-recording.
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

  function stopRecording() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setRecording(false);
  }

  async function startRecording() {
    if (disabled) return;
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
        onRecorded(audioBlob, mimeType);
      };

      mediaRecorder.start(250); // collect in 250ms chunks
      mediaRecorderRef.current = mediaRecorder;
      setRecording(true);
      setRecordingTime(0);
      timerRef.current = setInterval(() => setRecordingTime((t) => t + 1), 1000);
      maxRecordingTimerRef.current = setTimeout(() => {
        if (mediaRecorderRef.current?.state === "recording") stopRecording();
      }, MAX_RECORDING_MS);
    } catch {
      onUnavailable();
    }
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

  return { recording, recordingTime, startRecording, stopRecording, cancelRecording };
}
