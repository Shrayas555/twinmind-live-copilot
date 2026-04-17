"use client";

import { useRef, useState, useCallback, useEffect } from "react";

interface UseAudioRecorderOptions {
  apiKey: string;
  model: string;
  chunkDuration: number; // seconds per chunk
  onChunkTranscribed: (text: string) => void;
  /** Fired when a new MediaRecorder chunk begins — use for UI countdown until next transcript update. */
  onChunkStarted?: (info: { durationSec: number }) => void;
  /** Fired after a successful transcription — use for logging. */
  onChunkSuccess?: (durationMs: number) => void;
  onError: (msg: string) => void;
}

export function useAudioRecorder({
  apiKey,
  model,
  chunkDuration,
  onChunkTranscribed,
  onChunkStarted,
  onChunkSuccess,
  onError,
}: UseAudioRecorderOptions) {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isRecordingRef = useRef(false); // ref for closures inside onstop

  // MediaRecorder's onstop closes over the first transcribeBlob — keep latest values in refs
  // so every chunk uses the current API key, model, and transcript/suggestion callbacks.
  const apiKeyRef = useRef(apiKey);
  const modelRef = useRef(model);
  const onChunkTranscribedRef = useRef(onChunkTranscribed);
  const onChunkSuccessRef = useRef(onChunkSuccess);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    apiKeyRef.current = apiKey;
    modelRef.current = model;
    onChunkTranscribedRef.current = onChunkTranscribed;
    onChunkSuccessRef.current = onChunkSuccess;
    onErrorRef.current = onError;
  }, [apiKey, model, onChunkTranscribed, onChunkSuccess, onError]);

  const transcribeBlob = useCallback(async (blob: Blob) => {
    if (blob.size < 1000) return; // skip silence

    setIsTranscribing(true);
    const t0 = Date.now();
    try {
      const fd = new FormData();
      fd.append("audio", blob, "chunk.webm");
      fd.append("apiKey", apiKeyRef.current);
      fd.append("model", modelRef.current);

      const res = await fetch("/api/transcribe", { method: "POST", body: fd });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Transcription request failed" }));
        onErrorRef.current(err.error ?? "Transcription failed");
        return;
      }
      const data = await res.json();
      if (data.text?.trim()) {
        onChunkSuccessRef.current?.(Date.now() - t0);
        onChunkTranscribedRef.current(data.text.trim());
      }
    } catch (e) {
      onErrorRef.current(e instanceof Error ? e.message : "Transcription error");
    } finally {
      setIsTranscribing(false);
    }
  }, []);

  const startChunk = useCallback(
    (stream: MediaStream, overrideDuration?: number) => {
      const duration = overrideDuration ?? chunkDuration;
      const chunks: BlobPart[] = [];

      // Prefer webm/opus for broad browser support; fall back to whatever is available
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "";

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = async () => {
        const blob = new Blob(chunks, { type: mimeType || "audio/webm" });
        await transcribeBlob(blob);

        // Restart the next chunk only if user hasn't manually stopped
        if (isRecordingRef.current && streamRef.current) {
          startChunk(streamRef.current);
        }
      };

      recorder.start();
      onChunkStarted?.({ durationSec: duration });

      // Schedule end-of-chunk after the configured (or overridden) duration
      chunkTimerRef.current = setTimeout(() => {
        if (recorder.state === "recording") {
          recorder.stop();
        }
      }, duration * 1000);
    },
    [chunkDuration, transcribeBlob, onChunkStarted]
  );

  const startRecording = useCallback(async () => {
    if (isRecordingRef.current) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      isRecordingRef.current = true;
      setIsRecording(true);
      // First chunk is capped at 15s so the first suggestions appear quickly.
      // Subsequent chunks run at the full chunkDuration (default 30s) via onstop.
      startChunk(stream, Math.min(chunkDuration, 15));
    } catch (e) {
      if (e instanceof DOMException) {
        if (e.name === "NotAllowedError") {
          onError("Microphone access denied — allow mic access in your browser settings and try again.");
        } else if (e.name === "NotFoundError") {
          onError("No microphone found — connect a mic and try again.");
        } else if (e.name === "NotReadableError") {
          onError("Microphone is in use by another app — close it and try again.");
        } else {
          onError(e.message || "Microphone error");
        }
      } else {
        onError(e instanceof Error ? e.message : "Mic access denied");
      }
    }
  }, [startChunk, onError, chunkDuration]);

  const stopRecording = useCallback(() => {
    isRecordingRef.current = false;
    setIsRecording(false);

    if (chunkTimerRef.current) {
      clearTimeout(chunkTimerRef.current);
      chunkTimerRef.current = null;
    }
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop(); // this will still fire onstop and transcribe the last chunk
    }
    // Stop all tracks so the browser mic indicator goes away
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  /**
   * Force-flushes the current in-progress audio chunk: stops the recorder
   * (which transcribes the partial chunk and restarts), useful for manual refresh.
   */
  const flushChunk = useCallback(() => {
    if (!isRecordingRef.current || !recorderRef.current) return;
    if (recorderRef.current.state === "recording") {
      if (chunkTimerRef.current) {
        clearTimeout(chunkTimerRef.current);
        chunkTimerRef.current = null;
      }
      recorderRef.current.stop(); // onstop will transcribe and restart via startChunk
    }
  }, []);

  return { isRecording, isTranscribing, startRecording, stopRecording, flushChunk };
}
