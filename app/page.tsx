"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import TranscriptPanel from "@/components/TranscriptPanel";
import SuggestionsPanel from "@/components/SuggestionsPanel";
import ChatPanel from "@/components/ChatPanel";
import SettingsModal from "@/components/SettingsModal";
import ErrorBanner from "@/components/ErrorBanner";
import { useAudioRecorder } from "@/hooks/useAudioRecorder";
import { useSettings } from "@/hooks/useSettings";
import { getContextWindow, getSuggestionsContext, getLastExchange, genId } from "@/lib/defaults";
import type {
  TranscriptChunk,
  SuggestionBatch,
  ChatMessage,
  Suggestion,
  SessionExport,
  AppSettings,
} from "@/lib/types";

export default function Home() {
  const { settings, updateSettings, loaded } = useSettings();

  const [transcriptChunks, setTranscriptChunks] = useState<TranscriptChunk[]>([]);
  const [suggestionBatches, setSuggestionBatches] = useState<SuggestionBatch[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);

  const [clickedSuggestionIds, setClickedSuggestionIds] = useState<Set<string>>(new Set());
  const [isSuggestionsLoading, setIsSuggestionsLoading] = useState(false);
  const [isChatStreaming, setIsChatStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [nextRefreshIn, setNextRefreshIn] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const transcriptRef = useRef<TranscriptChunk[]>([]);
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isRecordingRef = useRef(false);
  const settingsRef = useRef(settings);

  useEffect(() => {
    transcriptRef.current = transcriptChunks;
  }, [transcriptChunks]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  // ── Suggestions ──────────────────────────────────────────────────────────

  const suggestionBatchesRef = useRef<SuggestionBatch[]>([]);
  useEffect(() => {
    suggestionBatchesRef.current = suggestionBatches;
  }, [suggestionBatches]);

  // Ref-based lock so the auto-refresh timer and onChunkTranscribed can't
  // launch two concurrent suggestion requests, which would produce duplicate batches
  const isSuggestionsInFlightRef = useRef(false);

  const generateSuggestions = useCallback(async () => {
    if (isSuggestionsInFlightRef.current) return;

    const s = settingsRef.current;
    const transcript = transcriptRef.current.map((c) => c.text).join(" ");

    if (!transcript.trim() || !s.groqApiKey) return;

    isSuggestionsInFlightRef.current = true;
    setIsSuggestionsLoading(true);
    setError(null);

    const context = getSuggestionsContext(transcript, s.suggestionsContextWords);
    // Last 4 sentences — explicit spotlight so the model immediately sees what was JUST said
    const lastExchange = getLastExchange(transcript, 4);

    // Collect previews from the last 3 batches to prevent repetition
    const recentBatches = suggestionBatchesRef.current.slice(-3);
    const previousPreviews = recentBatches.flatMap((b) =>
      b.suggestions.map((s) => s.preview)
    );

    try {
      const res = await fetch("/api/suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript: context,
          lastExchange,
          systemPrompt: s.suggestionsSystemPrompt,
          apiKey: s.groqApiKey,
          model: s.suggestionsModel,
          previousPreviews,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Request failed" }));
        setError(err.error ?? "Failed to generate suggestions");
        return;
      }

      const data = await res.json();
      if (data.suggestions?.length > 0) {
        const batch: SuggestionBatch = {
          id: genId(),
          suggestions: data.suggestions,
          timestamp: Date.now(),
          transcriptLength: transcript.length,
        };
        setSuggestionBatches((prev) => [...prev, batch]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error — check your connection.");
    } finally {
      isSuggestionsInFlightRef.current = false;
      setIsSuggestionsLoading(false);
    }
  }, []);

  // ── Auto-refresh timer ────────────────────────────────────────────────────

  const stopRefreshTimer = useCallback(() => {
    if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
    refreshTimerRef.current = null;
    countdownRef.current = null;
    setNextRefreshIn(null);
  }, []);

  const startRefreshTimer = useCallback(() => {
    stopRefreshTimer();
    const interval = settingsRef.current.autoRefreshInterval;
    setNextRefreshIn(interval);

    let remaining = interval;
    countdownRef.current = setInterval(() => {
      remaining -= 1;
      setNextRefreshIn(remaining > 0 ? remaining : interval);
      if (remaining <= 0) remaining = interval;
    }, 1000);

    refreshTimerRef.current = setInterval(() => {
      if (!isRecordingRef.current) return;
      // Skip auto-refresh if less than ~150 chars of new transcript since the last batch
      // (~30 words / ~14s of speech). Prevents wasted API calls during pauses.
      // Manual refresh always bypasses this check.
      const fullTranscript = transcriptRef.current.map((c) => c.text).join(" ");
      const lastBatch = suggestionBatchesRef.current.slice(-1)[0];
      const newChars = lastBatch
        ? fullTranscript.length - lastBatch.transcriptLength
        : fullTranscript.length;
      if (newChars >= 150) generateSuggestions();
    }, interval * 1000);
  }, [stopRefreshTimer, generateSuggestions]);

  // ── Audio recorder ────────────────────────────────────────────────────────

  const handleChunkTranscribed = useCallback(
    (text: string) => {
      const chunk: TranscriptChunk = { id: genId(), text, timestamp: Date.now() };
      setTranscriptChunks((prev) => {
        const updated = [...prev, chunk];
        transcriptRef.current = updated; // ref updated synchronously before generateSuggestions reads it
        return updated;
      });
      // transcriptRef.current is already updated above — generateSuggestions reads it directly
      generateSuggestions();
    },
    [generateSuggestions]
  );

  const { isRecording, isTranscribing, startRecording, stopRecording, flushChunk } = useAudioRecorder({
    apiKey: settings.groqApiKey,
    model: settings.transcriptionModel,
    chunkDuration: settings.autoRefreshInterval,
    onChunkTranscribed: handleChunkTranscribed,
    onError: setError,
  });

  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  const handleStartRecording = useCallback(async () => {
    setError(null);
    await startRecording();
    startRefreshTimer();
  }, [startRecording, startRefreshTimer]);

  const handleStopRecording = useCallback(() => {
    stopRecording();
    stopRefreshTimer();
  }, [stopRecording, stopRefreshTimer]);

  useEffect(() => () => stopRefreshTimer(), [stopRefreshTimer]);

  // ── Chat streaming helper ─────────────────────────────────────────────────

  const streamChat = useCallback(
    async (
      apiMessages: { role: "user" | "assistant"; content: string }[],
      displayUserMsg: ChatMessage,
      // When true, the user message already contains the transcript (suggestion click detail prompt)
      // so we skip embedding it again in the system prompt — avoids sending ~6k duplicate words
      transcriptAlreadyInMessage = false
    ) => {
      const s = settingsRef.current;
      setChatMessages((prev) => [...prev, displayUserMsg]);
      setIsChatStreaming(true);
      setStreamingContent("");
      setError(null);

      const transcriptContext = transcriptAlreadyInMessage
        ? ""
        : getContextWindow(
            transcriptRef.current.map((c) => c.text).join(" "),
            s.detailedAnswerContextWords
          );

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: apiMessages,
            systemPrompt: s.chatSystemPrompt,
            transcript: transcriptContext,
            apiKey: s.groqApiKey,
            model: s.chatModel,
          }),
        });

        if (!res.ok || !res.body) {
          const errBody = await res.json().catch(() => ({ error: "Chat request failed" }));
          setError(errBody.error ?? "Chat request failed");
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let full = "";
        let streamError = "";
        let streamDone = false;

        while (!streamDone) {
          const { done, value } = await reader.read();
          if (done) break;
          const lines = decoder.decode(value, { stream: true }).split("\n");
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const payload = line.slice(6);
            if (payload === "[DONE]") { streamDone = true; break; }
            try {
              const evt = JSON.parse(payload);
              if (evt.delta) {
                full += evt.delta;
                setStreamingContent(full);
              }
              if (evt.error) {
                streamError = evt.error;
                streamDone = true;
                break;
              }
            } catch {
              // partial SSE line — ignore
            }
          }
        }

        if (streamError) {
          setError(streamError);
        } else if (full) {
          setChatMessages((prev) => [
            ...prev,
            { id: genId(), role: "assistant", content: full, timestamp: Date.now() },
          ]);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Network error — check your connection.");
      } finally {
        setIsChatStreaming(false);
        setStreamingContent("");
      }
    },
    []
  );

  // ── User types in chat box ────────────────────────────────────────────────

  const handleChatSend = useCallback(
    (text: string) => {
      if (isChatStreaming) return;
      const userMsg: ChatMessage = {
        id: genId(),
        role: "user",
        content: text,
        timestamp: Date.now(),
      };
      // Build history — use apiContent where available so prior suggestion clicks
      // are represented by their full expanded prompt, not just the short preview
      const history = [
        ...chatMessages.map((m) => ({ role: m.role, content: m.apiContent ?? m.content })),
        { role: "user" as const, content: text },
      ];
      streamChat(history, userMsg);
    },
    [isChatStreaming, chatMessages, streamChat]
  );

  // ── Suggestion card clicked ───────────────────────────────────────────────

  const handleSuggestionClick = useCallback(
    (suggestion: Suggestion) => {
      if (isChatStreaming) return;
      const s = settingsRef.current;

      const transcriptContext = getContextWindow(
        transcriptRef.current.map((c) => c.text).join(" "),
        s.detailedAnswerContextWords
      );

      // Build the detailed answer prompt (replaces the user message content sent to the model)
      const detailedUserContent = s.detailedAnswerPrompt
        .replace("{transcript}", transcriptContext)
        .replace("{type}", suggestion.type)
        .replace("{preview}", suggestion.preview)
        .replace("{detailPrompt}", suggestion.detailPrompt);

      const displayMsg: ChatMessage = {
        id: genId(),
        role: "user",
        content: suggestion.preview,            // shown in UI
        apiContent: detailedUserContent,        // used in API history — full expanded prompt
        timestamp: Date.now(),
        fromSuggestionType: suggestion.type,    // for the type badge in chat
      };

      // History: previous messages using apiContent where available (preserves full context
      // for prior suggestion clicks) + this new detailed prompt as the current user turn
      const history = [
        ...chatMessages.map((m) => ({ role: m.role, content: m.apiContent ?? m.content })),
        { role: "user" as const, content: detailedUserContent },
      ];

      setClickedSuggestionIds((prev) => {
        const next = new Set(prev);
        next.add(suggestion.id);
        return next;
      });

      // transcriptAlreadyInMessage=true: detailed answer prompt already embeds the full transcript
      // so skip re-embedding it in the system prompt (avoids ~6000 words of duplicate context)
      streamChat(history, displayMsg, true);
    },
    [isChatStreaming, chatMessages, streamChat]
  );

  // ── Export ────────────────────────────────────────────────────────────────

  const exportSession = useCallback(() => {
    const s = settingsRef.current;
    const now = Date.now();

    // Compute session duration from the earliest event timestamp
    const allTimestamps = [
      ...transcriptChunks.map((c) => c.timestamp),
      ...suggestionBatches.map((b) => b.timestamp),
      ...chatMessages.map((m) => m.timestamp),
    ];
    const sessionStart = allTimestamps.length > 0 ? Math.min(...allTimestamps) : now;

    const data: SessionExport = {
      exportedAt: new Date(now).toISOString(),
      session: {
        durationMs: now - sessionStart,
        suggestionsModel: s.suggestionsModel,
        chatModel: s.chatModel,
        transcriptionModel: s.transcriptionModel,
      },
      transcript: transcriptChunks.map((c) => ({
        text: c.text,
        timestamp: new Date(c.timestamp).toISOString(),
      })),
      suggestionBatches: suggestionBatches.map((b) => ({
        timestamp: new Date(b.timestamp).toISOString(),
        suggestions: b.suggestions.map((s) => ({
          type: s.type,
          preview: s.preview,
          detailPrompt: s.detailPrompt,
        })),
      })),
      chat: chatMessages.map((m) => ({
        role: m.role,
        displayContent: m.content,
        ...(m.apiContent ? { apiContent: m.apiContent } : {}),
        timestamp: new Date(m.timestamp).toISOString(),
        ...(m.fromSuggestionType ? { fromSuggestionType: m.fromSuggestionType } : {}),
      })),
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    // Human-readable filename: twinmind-session-2026-04-16T14-30-00.json
    const dateStr = new Date(now).toISOString().slice(0, 19).replace(/:/g, "-");
    a.download = `twinmind-session-${dateStr}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [transcriptChunks, suggestionBatches, chatMessages]);

  // Show settings on first load if no API key
  useEffect(() => {
    if (loaded && !settings.groqApiKey) setShowSettings(true);
  }, [loaded, settings.groqApiKey]);

  if (!loaded) return null;

  const hasContent =
    transcriptChunks.length > 0 || suggestionBatches.length > 0 || chatMessages.length > 0;

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-zinc-200 overflow-hidden">
      {/* Top bar */}
      <header className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-800 bg-zinc-950 shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-white tracking-tight">
            TwinMind — Live Suggestions
          </span>
          <span className="hidden sm:block text-xs text-zinc-600">
            Transcript · Live Suggestions · Chat
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={exportSession}
            disabled={!hasContent}
            title="Export session as JSON"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs text-zinc-400 hover:text-white hover:bg-zinc-800 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Export
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs text-zinc-400 hover:text-white hover:bg-zinc-800 transition-all"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            Settings
            {!settings.groqApiKey && (
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 ml-0.5" />
            )}
          </button>
        </div>
      </header>

      {/* Error banner */}
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {/* 3-column layout */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        <div className="w-1/3 border-r border-zinc-800 flex flex-col min-h-0 overflow-hidden">
          <TranscriptPanel
            chunks={transcriptChunks}
            isRecording={isRecording}
            isTranscribing={isTranscribing}
            onStart={handleStartRecording}
            onStop={handleStopRecording}
            hasApiKey={!!settings.groqApiKey}
          />
        </div>
        <div className="w-1/3 border-r border-zinc-800 flex flex-col min-h-0 overflow-hidden">
          <SuggestionsPanel
            batches={suggestionBatches}
            isLoading={isSuggestionsLoading}
            isTranscribing={isTranscribing}
            isRecording={isRecording}
            nextRefreshIn={nextRefreshIn}
            onRefresh={() => {
              // If recording, flush the current audio chunk (transcribes it, then triggers
              // generateSuggestions via onChunkTranscribed) and reset the auto-refresh countdown
              // so the next auto-refresh is a full interval from now.
              // If not recording, generate directly from existing transcript.
              if (isRecording) {
                flushChunk();
                startRefreshTimer();
              } else {
                generateSuggestions();
              }
            }}
            onSuggestionClick={handleSuggestionClick}
            clickedIds={clickedSuggestionIds}
            hasTranscript={transcriptChunks.length > 0}
          />
        </div>
        <div className="w-1/3 flex flex-col min-h-0 overflow-hidden">
          <ChatPanel
            messages={chatMessages}
            isStreaming={isChatStreaming}
            streamingContent={streamingContent}
            onSend={handleChatSend}
          />
        </div>
      </div>

      {showSettings && (
        <SettingsModal
          settings={settings}
          onSave={(patch: Partial<AppSettings>) => updateSettings(patch)}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
