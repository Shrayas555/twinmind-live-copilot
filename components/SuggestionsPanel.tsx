"use client";

import { useEffect, useRef } from "react";
import type { SuggestionBatch, Suggestion, SuggestionType } from "@/lib/types";
import { formatTimestamp } from "@/lib/defaults";


interface Props {
  batches: SuggestionBatch[];
  isLoading: boolean;
  isTranscribing: boolean;
  isRecording: boolean;
  /** Seconds until current audio segment ends (~next transcript + suggestion refresh). */
  nextChunkIn: number | null;
  onRefresh: () => void;
  onSuggestionClick: (suggestion: Suggestion) => void;
  hasTranscript: boolean;
}

const TYPE_CONFIG: Record<
  SuggestionType,
  { label: string; color: string; bg: string; border: string; hoverBorder: string; detail: string }
> = {
  QUESTION: {
    label: "Question",
    color: "text-sky-400",
    bg: "bg-sky-400/10",
    border: "border-sky-400/30",
    hoverBorder: "hover:border-sky-400/50",
    detail: "Tap to get the exact question ready to ask →",
  },
  TALKING_POINT: {
    label: "Talking Point",
    color: "text-violet-400",
    bg: "bg-violet-400/10",
    border: "border-violet-400/30",
    hoverBorder: "hover:border-violet-400/50",
    detail: "Tap for how to frame it + objection handling →",
  },
  ANSWER: {
    label: "Answer",
    color: "text-emerald-400",
    bg: "bg-emerald-400/10",
    border: "border-emerald-400/30",
    hoverBorder: "hover:border-emerald-400/50",
    detail: "Tap for full answer with supporting points →",
  },
  FACT_CHECK: {
    label: "Fact Check",
    color: "text-amber-400",
    bg: "bg-amber-400/10",
    border: "border-amber-400/30",
    hoverBorder: "hover:border-amber-400/50",
    detail: "Tap to see what's actually true →",
  },
  CLARIFICATION: {
    label: "Clarification",
    color: "text-rose-400",
    bg: "bg-rose-400/10",
    border: "border-rose-400/30",
    hoverBorder: "hover:border-rose-400/50",
    detail: "Tap for plain-English definition + example →",
  },
};

function SuggestionCard({
  suggestion,
  onClick,
}: {
  suggestion: Suggestion;
  onClick: () => void;
}) {
  const cfg = TYPE_CONFIG[suggestion.type] ?? TYPE_CONFIG.QUESTION;

  return (
    <button
      onClick={onClick}
      className={`
        w-full text-left rounded-lg border p-3 transition-all duration-150
        bg-zinc-900 hover:bg-zinc-800/80
        border-zinc-800 ${cfg.hoverBorder}
        group focus:outline-none focus:ring-1 focus:ring-zinc-600
      `}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span
          className={`text-[10px] font-bold tracking-widest uppercase px-1.5 py-0.5 rounded ${cfg.bg} ${cfg.color} ${cfg.border} border`}
        >
          {cfg.label}
        </span>
      </div>
      <p className="text-sm text-zinc-200 leading-snug group-hover:text-white transition-colors">
        {suggestion.preview}
      </p>
      <p className={`text-[11px] mt-1.5 ${cfg.color} opacity-60 group-hover:opacity-90 transition-opacity`}>
        {cfg.detail}
      </p>
    </button>
  );
}

export default function SuggestionsPanel({
  batches,
  isLoading,
  isTranscribing,
  isRecording,
  nextChunkIn,
  onRefresh,
  onSuggestionClick,
  hasTranscript,
}: Props) {
  // Busy = transcribing audio chunk OR generating suggestions
  const isBusy = isTranscribing || isLoading;
  const busyLabel = isTranscribing ? "Transcribing…" : "Generating…";

  const listRef = useRef<HTMLDivElement>(null);
  const prevBatchCountRef = useRef(0);

  // Batches are never trimmed in app state. Newest batch is at the top; older batches stack below (scroll down for full history).
  // When a new batch arrives, gently scroll to top if the user was already reading the latest (near top).
  useEffect(() => {
    const el = listRef.current;
    if (!el || batches.length === 0) {
      prevBatchCountRef.current = batches.length;
      return;
    }
    const grew = batches.length > prevBatchCountRef.current;
    prevBatchCountRef.current = batches.length;
    if (!grew) return;

    const nearTop = el.scrollTop < 100;
    if (nearTop || batches.length === 1) {
      requestAnimationFrame(() => {
        el.scrollTo({ top: 0, behavior: batches.length === 1 ? "auto" : "smooth" });
      });
    }
  }, [batches.length]);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
        <span className="text-xs font-semibold tracking-widest text-zinc-400 uppercase">
          2. Live Suggestions
        </span>
        <span className="text-xs font-mono text-zinc-500" title="All batches this session are kept">
          {batches.length} {batches.length === 1 ? "BATCH" : "BATCHES"} · full history
        </span>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-800/60">
        <button
          onClick={onRefresh}
          disabled={isBusy || !hasTranscript}
          className="
            flex items-center gap-1.5 text-xs text-zinc-300 hover:text-white
            bg-zinc-800 hover:bg-zinc-700 px-3 py-1.5 rounded-md transition-all
            disabled:opacity-40 disabled:cursor-not-allowed
          "
        >
          <svg
            className={`w-3.5 h-3.5 ${isBusy ? "animate-spin" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          {isBusy ? busyLabel : "Reload suggestions"}
        </button>

        {nextChunkIn !== null && (
          <span className="text-[11px] text-zinc-600 font-mono" title="Time until this audio chunk is sent for transcription">
            next chunk ~{nextChunkIn}s
          </span>
        )}
      </div>

      {/* Suggestion batches — chronological, unbounded; scroll for full history */}
      <div
        ref={listRef}
        className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-4 py-3 space-y-4 scrollbar-thin scrollbar-thumb-zinc-700"
      >
        {/* Loading skeleton — first ever load */}
        {isBusy && batches.length === 0 && (
          <div className="space-y-2 mt-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 rounded-lg bg-zinc-800/50 animate-pulse" />
            ))}
          </div>
        )}

        {/* "Generating new batch" row at top when refreshing with existing batches */}
        {isBusy && batches.length > 0 && (
          <div className="flex items-center gap-2 px-1 py-2">
            <div className="flex gap-1">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce"
                  style={{ animationDelay: `${i * 120}ms` }}
                />
              ))}
            </div>
            <span className="text-xs text-zinc-500">{busyLabel.toLowerCase()} new batch…</span>
          </div>
        )}

        {batches.length === 0 && !isBusy && (
          <p className="text-zinc-600 text-sm italic text-center mt-8">
            {isRecording
              ? "Recording… suggestions will appear after first transcript chunk."
              : "Suggestions appear here once recording starts."}
          </p>
        )}

        {/* Newest batch at top; older batches stack below at 50% opacity */}
        {[...batches].reverse().map((batch, batchIdx) => {
          const isLatest = batchIdx === 0;

          return (
            <div
              key={batch.id}
              className={
                isLatest
                  ? "rounded-lg border border-emerald-500/25 bg-emerald-500/[0.03] p-3 -mx-1 opacity-100 transition-opacity [content-visibility:auto]"
                  : "rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-3 -mx-1 opacity-50 hover:opacity-70 transition-opacity [content-visibility:auto]"
              }
            >
              <div className="flex items-center gap-2 mb-2.5">
                <span className="text-[11px] font-mono text-zinc-500">
                  {formatTimestamp(batch.timestamp)}
                </span>
                {isLatest && (
                  <span className="text-[10px] font-bold tracking-widest text-emerald-400 bg-emerald-400/10 border border-emerald-400/30 px-1.5 py-0.5 rounded uppercase">
                    Latest
                  </span>
                )}
                {!isLatest && (
                  <span className="text-[10px] font-medium tracking-wider text-zinc-600 uppercase">
                    Earlier
                  </span>
                )}
              </div>

              <div className="space-y-2">
                {batch.suggestions.map((s) => (
                  <SuggestionCard
                    key={s.id}
                    suggestion={s}
                    onClick={() => onSuggestionClick(s)}
                  />
                ))}
              </div>

              {batchIdx < batches.length - 1 && (
                <div className="border-b border-zinc-800/50 mt-4 -mx-1" aria-hidden />
              )}
            </div>
          );
        })}
        {batches.length > 1 && (
          <p className="text-center text-[10px] text-zinc-600 py-3 pb-1">
            ↓ Scroll for full session history — nothing is removed
          </p>
        )}
      </div>
    </div>
  );
}
