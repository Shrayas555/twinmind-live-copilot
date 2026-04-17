"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatMessage, SuggestionType } from "@/lib/types";
import { formatTimestamp } from "@/lib/defaults";

interface Props {
  messages: ChatMessage[];
  isStreaming: boolean;
  streamingContent: string;
  onSend: (text: string) => void;
}

// Mirrors TYPE_CONFIG in SuggestionsPanel — keeps badge style consistent
const TYPE_BADGE: Record<SuggestionType, { label: string; color: string; bg: string; border: string }> = {
  QUESTION:      { label: "Question",      color: "text-sky-400",    bg: "bg-sky-400/10",    border: "border-sky-400/30" },
  TALKING_POINT: { label: "Talking Point", color: "text-violet-400", bg: "bg-violet-400/10", border: "border-violet-400/30" },
  ANSWER:        { label: "Answer",        color: "text-emerald-400",bg: "bg-emerald-400/10",border: "border-emerald-400/30" },
  FACT_CHECK:    { label: "Fact Check",    color: "text-amber-400",  bg: "bg-amber-400/10",  border: "border-amber-400/30" },
  CLARIFICATION: { label: "Clarification", color: "text-rose-400",   bg: "bg-rose-400/10",   border: "border-rose-400/30" },
};

export default function ChatPanel({ messages, isStreaming, streamingContent, onSend }: Props) {
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Scroll on new messages, streaming tokens, or when "Thinking…" appears
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent, isStreaming]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || isStreaming) return;
    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
    onSend(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

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
          <div
            key={msg.id}
            className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}
          >
            <div
              className={`
                max-w-[90%] rounded-lg px-3 py-2.5 text-sm leading-relaxed
                ${msg.role === "user"
                  ? "bg-zinc-700 text-zinc-100"
                  : "bg-zinc-800/80 text-zinc-200 border border-zinc-700/50"
                }
              `}
            >
              {/* Suggestion-click: show type badge instead of plain "FROM SUGGESTION" */}
              {msg.fromSuggestionType && (() => {
                const cfg = TYPE_BADGE[msg.fromSuggestionType];
                return (
                  <span
                    className={`inline-block text-[10px] font-bold tracking-widest uppercase px-1.5 py-0.5 rounded border mb-1.5 ${cfg.bg} ${cfg.color} ${cfg.border}`}
                  >
                    {cfg.label}
                  </span>
                );
              })()}
              <MarkdownText text={msg.content} />
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
                <>
                  <MarkdownText text={streamingContent} />
                  <span className="inline-block w-1.5 h-4 bg-zinc-400 animate-pulse ml-0.5 -mb-0.5" />
                </>
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

/**
 * Markdown renderer for AI responses.
 * Handles: ## headers, ### headers, **bold**, `inline code`,
 * --- dividers, • / - / * bullets, 1. numbered lists, blank line spacing.
 */
function MarkdownText({ text }: { text: string }) {
  const lines = text.split("\n");

  return (
    <div>
      {lines.map((line, i) => {
        const trimmed = line.trim();
        const isEmpty = trimmed === "";

        // Collapse consecutive blank lines into a single small gap
        if (isEmpty) {
          const prevWasEmpty = i > 0 && lines[i - 1].trim() === "";
          return prevWasEmpty ? null : <div key={i} className="h-2" />;
        }

        // Horizontal rule
        if (trimmed === "---" || trimmed === "***" || trimmed === "___") {
          return <hr key={i} className="border-zinc-700 my-2" />;
        }

        // ## Heading
        if (trimmed.startsWith("## ")) {
          return (
            <p key={i} className="font-semibold text-white mt-3 mb-1 leading-snug">
              {renderInline(trimmed.slice(3))}
            </p>
          );
        }

        // ### Heading
        if (trimmed.startsWith("### ")) {
          return (
            <p key={i} className="font-semibold text-zinc-300 mt-2 mb-0.5 leading-snug text-[13px]">
              {renderInline(trimmed.slice(4))}
            </p>
          );
        }

        const isBullet = /^[•\-*]\s/.test(trimmed);
        const isNumbered = /^\d+\.\s/.test(trimmed);

        let content = trimmed;
        if (isBullet) content = trimmed.replace(/^[•\-*]\s/, "");
        if (isNumbered) content = trimmed.replace(/^\d+\.\s/, "");
        const numPrefix = isNumbered ? (trimmed.match(/^(\d+)\./)?.[1] ?? "") : "";

        const rendered = renderInline(content);

        if (isBullet) {
          return (
            <div key={i} className="flex gap-2 items-start mt-0.5">
              <span className="text-zinc-400 shrink-0 mt-px leading-snug">•</span>
              <span className="flex-1 leading-snug">{rendered}</span>
            </div>
          );
        }

        if (isNumbered) {
          return (
            <div key={i} className="flex gap-2 items-start mt-0.5">
              <span className="text-zinc-400 font-mono text-xs shrink-0 mt-px w-4 text-right leading-snug">
                {numPrefix}.
              </span>
              <span className="flex-1 leading-snug">{rendered}</span>
            </div>
          );
        }

        return (
          <p key={i} className="leading-snug mt-0.5 first:mt-0">
            {rendered}
          </p>
        );
      })}
    </div>
  );
}

/** Splits a line on **bold** and `code` markers and returns React nodes */
function renderInline(text: string): React.ReactNode[] {
  // Split on **bold** and `code` patterns
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (/^\*\*.*\*\*$/.test(part)) {
      return (
        <strong key={i} className="text-white font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (/^`.*`$/.test(part)) {
      return (
        <code key={i} className="bg-zinc-700/60 text-zinc-200 px-1 rounded font-mono text-[11px]">
          {part.slice(1, -1)}
        </code>
      );
    }
    return <span key={i}>{part}</span>;
  });
}
