"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@/lib/types";
import { formatTimestamp } from "@/lib/defaults";

interface Props {
  messages: ChatMessage[];
  isStreaming: boolean;
  streamingContent: string;
  onSend: (text: string) => void;
}

export default function ChatPanel({ messages, isStreaming, streamingContent, onSend }: Props) {
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll on new messages / streaming updates
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || isStreaming) return;
    setInput("");
    onSend(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Auto-resize textarea
  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
        <span className="text-xs font-semibold tracking-widest text-zinc-400 uppercase">
          3. Chat (Detailed Answers)
        </span>
        <span className="text-[10px] font-bold tracking-widest text-zinc-500 bg-zinc-800 border border-zinc-700 px-1.5 py-0.5 rounded uppercase">
          Session Only
        </span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 scrollbar-thin scrollbar-thumb-zinc-700">
        {messages.length === 0 && !isStreaming && (
          <div className="text-sm text-zinc-500 space-y-2 mt-4">
            <p>Clicking a suggestion adds it to this chat and streams a detailed answer.</p>
            <p className="text-zinc-600">
              One continuous chat per session. No login, no data persistence.
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}>
            <div
              className={`
                max-w-[90%] rounded-lg px-3 py-2.5 text-sm leading-relaxed
                ${msg.role === "user"
                  ? "bg-zinc-700 text-zinc-100"
                  : "bg-zinc-800/80 text-zinc-200 border border-zinc-700/50"
                }
              `}
            >
              {msg.fromSuggestion && (
                <p className="text-[10px] font-bold tracking-wider text-zinc-500 uppercase mb-1">
                  From suggestion
                </p>
              )}
              <div className="whitespace-pre-wrap prose-invert">
                <MarkdownText text={msg.content} />
              </div>
            </div>
            <span className="text-[10px] text-zinc-600 font-mono mt-0.5 px-1">
              {formatTimestamp(msg.timestamp)}
            </span>
          </div>
        ))}

        {/* Streaming assistant message */}
        {isStreaming && (
          <div className="flex flex-col items-start">
            <div className="max-w-[90%] rounded-lg px-3 py-2.5 text-sm leading-relaxed bg-zinc-800/80 text-zinc-200 border border-zinc-700/50">
              {streamingContent ? (
                <div className="whitespace-pre-wrap">
                  <MarkdownText text={streamingContent} />
                  <span className="inline-block w-1.5 h-4 bg-zinc-400 animate-pulse ml-0.5 -mb-0.5" />
                </div>
              ) : (
                <span className="text-zinc-500 italic">Thinking…</span>
              )}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-zinc-800 px-4 py-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything…"
            rows={1}
            className="
              flex-1 resize-none rounded-lg bg-zinc-800 border border-zinc-700
              text-sm text-zinc-200 placeholder-zinc-600
              px-3 py-2 focus:outline-none focus:border-zinc-600
              min-h-[38px] max-h-32 scrollbar-thin scrollbar-thumb-zinc-700
            "
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isStreaming}
            className="
              px-4 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-sm text-white font-medium
              transition-colors disabled:opacity-40 disabled:cursor-not-allowed
              flex items-center gap-1.5 whitespace-nowrap
            "
          >
            {isStreaming ? (
              <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            ) : (
              "Send"
            )}
          </button>
        </div>
        <p className="text-[11px] text-zinc-700 mt-1.5">Enter to send · Shift+Enter for newline</p>
      </div>
    </div>
  );
}

/** Minimal markdown renderer for bold + bullet lists */
function MarkdownText({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <>
      {lines.map((line, i) => {
        const isBullet = /^[-*]\s/.test(line);
        const content = isBullet ? line.replace(/^[-*]\s/, "") : line;
        const parts = content.split(/(\*\*[^*]+\*\*)/g);
        const rendered = parts.map((part, j) => {
          if (/^\*\*.*\*\*$/.test(part)) {
            return <strong key={j} className="text-white">{part.slice(2, -2)}</strong>;
          }
          return <span key={j}>{part}</span>;
        });
        return (
          <p key={i} className={isBullet ? "flex gap-1.5" : ""}>
            {isBullet && <span className="text-zinc-500 mt-0.5">•</span>}
            <span>{rendered}</span>
          </p>
        );
      })}
    </>
  );
}
