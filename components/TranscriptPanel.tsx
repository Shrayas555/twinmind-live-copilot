"use client";

import { useEffect, useRef } from "react";
import type { TranscriptChunk } from "@/lib/types";
import { formatTimestamp } from "@/lib/defaults";

interface Props {
  chunks: TranscriptChunk[];
  isRecording: boolean;
  isTranscribing: boolean;
  onStart: () => void;
  onStop: () => void;
  hasApiKey: boolean;
}

export default function TranscriptPanel({
  chunks,
  isRecording,
  isTranscribing,
  onStart,
  onStop,
  hasApiKey,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to latest
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chunks]);

  const status = isRecording
    ? isTranscribing
      ? "PROCESSING"
      : "LIVE"
    : "IDLE";

  const statusColor =
    status === "LIVE"
      ? "text-emerald-400"
      : status === "PROCESSING"
      ? "text-amber-400"
      : "text-zinc-500";

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
        <span className="text-xs font-semibold tracking-widest text-zinc-400 uppercase">
          1. Mic &amp; Transcript
        </span>
        <span className={`text-xs font-mono font-bold tracking-widest ${statusColor}`}>
          {status}
        </span>
      </div>

      {/* Mic button */}
      <div className="flex flex-col items-center gap-3 px-4 py-5 border-b border-zinc-800">
        <button
          onClick={isRecording ? onStop : onStart}
          disabled={!hasApiKey}
          aria-label={isRecording ? "Stop recording" : "Start recording"}
          className={`
            w-14 h-14 rounded-full flex items-center justify-center transition-all duration-200
            ${isRecording
              ? "bg-red-500 hover:bg-red-600 shadow-lg shadow-red-500/30 animate-pulse"
              : "bg-blue-600 hover:bg-blue-500 shadow-md shadow-blue-600/25"
            }
            disabled:opacity-40 disabled:cursor-not-allowed
          `}
        >
          {isRecording ? (
            /* Stop icon */
            <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          ) : (
            /* Mic icon */
            <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 1a4 4 0 014 4v7a4 4 0 01-8 0V5a4 4 0 014-4zm0 2a2 2 0 00-2 2v7a2 2 0 004 0V5a2 2 0 00-2-2z" />
              <path d="M7 11a1 1 0 011 1 4 4 0 008 0 1 1 0 112 0 6 6 0 01-5 5.91V20h2a1 1 0 010 2H9a1 1 0 010-2h2v-2.09A6 6 0 016 12a1 1 0 011-1z" />
            </svg>
          )}
        </button>

        <p className="text-xs text-zinc-500 text-center leading-relaxed">
          {!hasApiKey
            ? "Add a Groq API key in Settings to start."
            : isRecording
            ? "Recording · suggestions refresh after each chunk"
            : "Click mic to start. Transcript appends every ~30s (first chunk sooner)."}
        </p>
      </div>

      {/* Transcript scroll area */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 scrollbar-thin scrollbar-thumb-zinc-700">
        {chunks.length === 0 ? (
          <p className="text-zinc-600 text-sm italic text-center mt-8">
            No transcript yet — start the mic.
          </p>
        ) : (
          chunks.map((chunk) => (
            <div key={chunk.id} className="group">
              <span className="text-xs text-zinc-600 font-mono block mb-0.5">
                {formatTimestamp(chunk.timestamp)}
              </span>
              <p className="text-sm text-zinc-200 leading-relaxed">{chunk.text}</p>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
