"use client";

import { useState } from "react";
import type { LogEntry } from "@/lib/types";

interface Props {
  entries: LogEntry[];
}

const TYPE_LABEL: Record<string, string> = {
  transcribe: "TRANSCRIBE",
  suggestions: "SUGGESTIONS",
  chat: "CHAT",
};

function formatMs(ms: number): string {
  if (ms === 0) return "";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", { hour12: false });
}

export default function DebugLog({ entries }: Props) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyAll = () => {
    const text = entries
      .map(
        (e) =>
          `[${formatTime(e.timestamp)}] ${e.status.toUpperCase()} ${TYPE_LABEL[e.type] ?? e.type}${e.durationMs ? ` (${formatMs(e.durationMs)})` : ""} — ${e.detail}`
      )
      .join("\n");
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const errorCount = entries.filter((e) => e.status === "error").length;

  return (
    <div className="fixed bottom-3 right-3 z-40 flex flex-col items-end gap-1">
      {/* Toggle button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={`
          flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-mono transition-all shadow-lg
          ${errorCount > 0
            ? "bg-red-950 border border-red-700/60 text-red-300 hover:bg-red-900"
            : "bg-zinc-800 border border-zinc-700 text-zinc-500 hover:text-zinc-300"
          }
        `}
        title="Toggle API call log"
      >
        <span className={`w-1.5 h-1.5 rounded-full ${errorCount > 0 ? "bg-red-400" : entries.length > 0 ? "bg-emerald-400" : "bg-zinc-600"}`} />
        Logs ({entries.length})
        {errorCount > 0 && <span className="text-red-400 font-bold">{errorCount} err</span>}
      </button>

      {/* Log panel */}
      {open && (
        <div className="w-96 max-h-72 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800">
            <span className="text-[11px] font-semibold text-zinc-400 tracking-widest uppercase">API Log</span>
            <div className="flex items-center gap-2">
              <button
                onClick={copyAll}
                disabled={entries.length === 0}
                className="text-[10px] px-2 py-0.5 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-300 transition-colors disabled:opacity-40"
              >
                {copied ? "Copied ✓" : "Copy all"}
              </button>
              <button onClick={() => setOpen(false)} className="text-zinc-500 hover:text-white text-sm leading-none">✕</button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-2 py-1.5 space-y-0.5 scrollbar-thin scrollbar-thumb-zinc-700">
            {entries.length === 0 ? (
              <p className="text-[11px] text-zinc-600 italic text-center py-4">No API calls yet</p>
            ) : (
              [...entries].reverse().map((e) => (
                <div
                  key={e.id}
                  className={`flex items-start gap-2 px-2 py-1 rounded text-[10px] font-mono ${
                    e.status === "error" ? "bg-red-950/40 text-red-300" : "text-zinc-400"
                  }`}
                >
                  <span className="text-zinc-600 shrink-0">{formatTime(e.timestamp)}</span>
                  <span className={`shrink-0 font-bold ${e.status === "error" ? "text-red-400" : "text-emerald-500"}`}>
                    {e.status === "error" ? "ERR" : "OK "}
                  </span>
                  <span className={`shrink-0 ${e.type === "suggestions" ? "text-violet-400" : e.type === "chat" ? "text-sky-400" : "text-amber-400"}`}>
                    {TYPE_LABEL[e.type]}
                  </span>
                  {e.durationMs > 0 && (
                    <span className="text-zinc-600 shrink-0">{formatMs(e.durationMs)}</span>
                  )}
                  <span className="break-all leading-snug min-w-0">{e.detail}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
