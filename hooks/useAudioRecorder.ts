"use client";

import { useRef, useState, useCallback } from "react";

interface UseAudioRecorderOptions {
  apiKey: string;
  model: string;
  chunkDuration: number; // seconds per chunk
  onChunkTranscribed: (text: string) => void;
  onError: (msg: string) => void;
}

export function useAudioRecorder({
  apiKey,
  model,
  chunkDuration,
  onChunkTranscribed,
  onError,
}: UseAudioRecorderOptions) {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isRecordingRef = useRef(false); // ref for closures inside onstop

  const transcribeBlob = useCallback(
    async (blob: Blob) => {
      if (blob.size < 1000) return; // skip silence

      setIsTranscribing(true);
      try {
        const fd = new FormData();
        fd.append("audio", blob, "chunk.webm");
        fd.append("apiKey", apiKey);
        fd.append("model", model);

        const res = await fetch("/api/transcribe", { method: "POST", body: fd });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Transcription request failed" }));
          onError(err.error ?? "Transcription failed");
          return;
        }
        const data = await res.json();
        if (data.text?.trim()) {
          onChunkTranscribed(data.text.trim());
        }
      } catch (e) {
        onError(e instanceof Error ? e.message : "Transcription error");
      } finally {
        setIsTranscribing(false);
      }
    },
    [apiKey, model, onChunkTranscribed, onError]
  );

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

      // Schedule end-of-chunk after the configured (or overridden) duration
      chunkTimerRef.current = setTimeout(() => {
        if (recorder.state === "recording") {
          recorder.stop();
        }
      }, duration * 1000);
    },
    [chunkDuration, transcribeBlob]
  );

  const startRecording = useCallback(async () => {
    if (isRecordingRef.current) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      isRecordingRef.current = true;
      setIsRecording(true);
      // First chunk is shorter so initial suggestions appear faster;
      // subsequent chunks restart at full chunkDuration via onstop → startChunk(stream)
      startChunk(stream, Math.min(chunkDuration, 20));
    } catch (e) {
      onError(e instanceof Error ? e.message : "Mic access denied");
    }
  }, [startChunk, onError]);

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
