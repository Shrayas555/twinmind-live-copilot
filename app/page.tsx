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

  const [isSuggestionsLoading, setIsSuggestionsLoading] = useState(false);
  const [isSuggestionsQueued, setIsSuggestionsQueued] = useState(false);
  const [isChatStreaming, setIsChatStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  /** Seconds until the current audio chunk ends (~next transcript append). */
  const [nextChunkIn, setNextChunkIn] = useState<number | null>(null);
  const [chunkTick, setChunkTick] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const transcriptRef = useRef<TranscriptChunk[]>([]);
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

  // Ref-based lock so we never run two Groq suggestion calls at once.
  // If a new transcript chunk arrives mid-flight, we set pending — otherwise that
  // refresh is lost forever and the UI stays stuck on one batch.
  const isSuggestionsInFlightRef = useRef(false);
  const suggestionsPendingRef = useRef(false);
  const forceNextSuggestionRef = useRef(false);
  // Minimum gap between suggestion calls — prevents Groq congestion when rapid
  // reloads or back-to-back transcription events queue calls immediately.
  // After failures, backoff extends so Groq can recover before we retry.
  const lastSuggestionEndTimeRef = useRef(0);
  const suggestionsCooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const consecutiveSuggestionFailuresRef = useRef(0);
  const MIN_SUGGESTION_COOLDOWN_MS = 8000;
  // AbortController for the active suggestions fetch — lets streamChat cancel it
  // immediately when a chat starts, freeing full Groq bandwidth for the chat call.
  const suggestionsAbortRef = useRef<AbortController | null>(null);

  // Ref-based chat lock — React state is async so two rapid clicks can both pass
  // an `if (isChatStreaming) return` guard before the state re-render. A ref is
  // synchronous and closes the race window completely.
  const isChatStreamingRef = useRef(false);
  // Stable ref to generateSuggestions so streamChat can trigger pending suggestions
  // after a chat completes without creating a circular useCallback dependency.
  const generateSuggestionsRef = useRef<(() => void) | null>(null);

  const generateSuggestions = useCallback(async (force = false) => { // eslint-disable-line react-hooks/exhaustive-deps
    const isForced = force || forceNextSuggestionRef.current;
    forceNextSuggestionRef.current = false;
    console.log("[sugg] called isForced=%s inFlight=%s", isForced, isSuggestionsInFlightRef.current);
    if (isSuggestionsInFlightRef.current) {
      suggestionsPendingRef.current = true;
      console.log("[sugg] blocked: in-flight");
      return;
    }

    const cooldownRemaining = MIN_SUGGESTION_COOLDOWN_MS - (Date.now() - lastSuggestionEndTimeRef.current);
    if (cooldownRemaining > 0) {
      suggestionsPendingRef.current = true;
      console.log("[sugg] blocked: cooldown %dms remaining", Math.round(cooldownRemaining));
      if (!suggestionsCooldownTimerRef.current) {
        suggestionsCooldownTimerRef.current = setTimeout(() => {
          suggestionsCooldownTimerRef.current = null;
          if (suggestionsPendingRef.current) {
            suggestionsPendingRef.current = false;
            void generateSuggestions();
          }
        }, cooldownRemaining);
      }
      return;
    }

    if (isChatStreamingRef.current) {
      suggestionsPendingRef.current = true;
      console.log("[sugg] blocked: chat streaming");
      return;
    }

    const s = settingsRef.current;
    const transcript = transcriptRef.current.map((c) => c.text).join(" ");

    if (!transcript.trim() || !s.groqApiKey) { console.log("[sugg] blocked: no transcript or key"); return; }

    if (!isForced) {
      const lastBatch = suggestionBatchesRef.current[suggestionBatchesRef.current.length - 1];
      const newChars = lastBatch ? transcript.length - lastBatch.transcriptLength : 999;
      console.log("[sugg] new-speech check: %d new chars (need 150)", newChars);
      if (lastBatch && newChars < 150) { console.log("[sugg] blocked: not enough new speech"); return; }
    }

    isSuggestionsInFlightRef.current = true;
    setIsSuggestionsQueued(false);
    setIsSuggestionsLoading(true);
    setError(null);

    const transcriptLenAtRequest = transcript.length;

    const context = getSuggestionsContext(transcript, s.suggestionsContextWords);
    // Use the latest Whisper chunk directly — it IS what was just said (15–30s of speech).
    // Fallback to sentence-parsed extraction only when no chunks exist yet.
    const latestChunk = transcriptRef.current[transcriptRef.current.length - 1];
    const lastExchange = latestChunk?.text || getLastExchange(transcript, 4);

    // Last batch only (max 3 previews) — more previews in the user message causes parse failures.
    const recentBatches = suggestionBatchesRef.current.slice(-1);
    const previousPreviews = recentBatches.flatMap((b) =>
      b.suggestions.map((s) => s.preview).filter(Boolean)
    );

    const t0 = Date.now();
    // Extra delay to add after this call finishes — non-zero after failures so Groq recovers.
    let failureBackoffMs = 0;

    const abortCtrl = new AbortController();
    suggestionsAbortRef.current = abortCtrl;

    try {
      const res = await fetch("/api/suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abortCtrl.signal,
        body: JSON.stringify({
          transcript: context,
          lastExchange,
          systemPrompt: s.suggestionsPrompt,
          apiKey: s.groqApiKey,
          model: s.suggestionsModel,
          previousPreviews,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Request failed" }));
        const msg = err.error ?? "Failed to generate suggestions";
        setError(msg);
        consecutiveSuggestionFailuresRef.current++;
        failureBackoffMs = Math.min(15000 * consecutiveSuggestionFailuresRef.current, 60000);
        return;
      }

      const data = await res.json();

      // New transcript may have landed while Groq was streaming — run again so the next batch matches latest speech.
      const transcriptAfter = transcriptRef.current.map((c) => c.text).join(" ");
      if (transcriptAfter.length > transcriptLenAtRequest) {
        suggestionsPendingRef.current = true;
      }

      if (data.parseError) {
        const detail = data.rawSample
          ? `JSON parse error. Model output: ${data.rawSample}`
          : "JSON parse error — model returned unparseable output.";
        consecutiveSuggestionFailuresRef.current++;
        failureBackoffMs = Math.min(15000 * consecutiveSuggestionFailuresRef.current, 60000);
        return;
      }

      if (data.suggestions?.length > 0) {
        consecutiveSuggestionFailuresRef.current = 0; // reset on success
        const batch: SuggestionBatch = {
          id: genId(),
          suggestions: data.suggestions,
          timestamp: Date.now(),
          transcriptLength: transcript.length,
        };
        // Keep every batch for the whole session (no cap / no trim); sync ref immediately for chained/pending calls
        setSuggestionBatches((prev) => {
          const next = [...prev, batch];
          suggestionBatchesRef.current = next;
          return next;
        });
      }
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        // Cancelled by a chat request — not an error. Pending was already set by
        // streamChat so suggestions will retry automatically after chat completes.
        return;
      }
      const msg = e instanceof Error ? e.message : "Network error — check your connection.";
      setError(msg);
      consecutiveSuggestionFailuresRef.current++;
      failureBackoffMs = Math.min(15000 * consecutiveSuggestionFailuresRef.current, 60000);
    } finally {
      suggestionsAbortRef.current = null;
      isSuggestionsInFlightRef.current = false;
      // After a slow successful call (>5s), add extra cooldown proportional to the
      // excess so Groq has time to recover. A 9s call → 4s extra → 12s total gap.
      // This auto-throttles the feedback loop that makes long meetings progressively slower.
      const callDurationMs = Date.now() - t0;
      const slowCallExtraMs = !failureBackoffMs && callDurationMs > 5000
        ? Math.min(callDurationMs - 5000, 10000)
        : 0;
      lastSuggestionEndTimeRef.current = Date.now() + failureBackoffMs + slowCallExtraMs;
      setIsSuggestionsLoading(false);
      if (suggestionsPendingRef.current) {
        suggestionsPendingRef.current = false;
        queueMicrotask(() => {
          void generateSuggestions(); // cooldown check (+ any backoff) runs at the top
        });
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    generateSuggestionsRef.current = generateSuggestions;
  }, [generateSuggestions]);

  // ── Chunk countdown (aligned with MediaRecorder segment length) ───────────

  const chunkEndAtRef = useRef<number | null>(null);

  const handleChunkTranscribed = useCallback(
    (text: string) => {
      const chunk: TranscriptChunk = { id: genId(), text, timestamp: Date.now() };
      // Update ref BEFORE calling generateSuggestions — React's state updater runs during
      // reconciliation (deferred), so we cannot rely on the setState callback to update
      // transcriptRef synchronously. generateSuggestions reads transcriptRef directly.
      transcriptRef.current = [...transcriptRef.current, chunk];
      setTranscriptChunks(transcriptRef.current);
      console.log("[transcribe] chunk landed, forceFlag=%s", forceNextSuggestionRef.current);
      generateSuggestions();
    },
    [generateSuggestions]
  );

  const onRecorderChunkStarted = useCallback(({ durationSec }: { durationSec: number }) => {
    chunkEndAtRef.current = Date.now() + durationSec * 1000;
    setChunkTick((t) => t + 1);
  }, []);

  const { isRecording, isTranscribing, startRecording, stopRecording, flushChunk } = useAudioRecorder({
    apiKey: settings.groqApiKey,
    model: settings.transcriptionModel,
    chunkDuration: settings.autoRefreshInterval,
    onChunkTranscribed: handleChunkTranscribed,
    onChunkStarted: onRecorderChunkStarted,
    onError: (msg: string) => {
      setError(msg);
    },
    onChunkSuccess: (durationMs: number) => {
    },
  });

  useEffect(() => {
    if (!isRecording) {
      chunkEndAtRef.current = null;
      setNextChunkIn(null);
      return;
    }
    if (isTranscribing) {
      setNextChunkIn(null);
      return;
    }

    const tick = () => {
      const end = chunkEndAtRef.current;
      if (end == null) {
        setNextChunkIn(null);
        return;
      }
      setNextChunkIn(Math.max(0, Math.ceil((end - Date.now()) / 1000)));
    };

    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [isRecording, isTranscribing, chunkTick]);

  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  const handleStartRecording = useCallback(async () => {
    setError(null);
    await startRecording();
  }, [startRecording]);

  const handleStopRecording = useCallback(() => {
    chunkEndAtRef.current = null;
    setNextChunkIn(null);
    stopRecording();
  }, [stopRecording]);

  // ── Chat streaming helper ─────────────────────────────────────────────────

  const streamChat = useCallback(
    async (
      apiMessages: { role: "user" | "assistant"; content: string }[],
      displayUserMsg: ChatMessage,
      // When true, the user message already contains the transcript (suggestion click detail prompt)
      // so we skip embedding it again in the system prompt — avoids sending ~6k duplicate words
      transcriptAlreadyInMessage = false
    ) => {
      // Synchronous ref guard — closes the race window between two rapid clicks
      // that both pass an async-state check before the first re-render.
      if (isChatStreamingRef.current) return;
      isChatStreamingRef.current = true;

      // If a suggestions call is already in-flight, abort it immediately so chat
      // gets full Groq bandwidth. Mark pending so it retries after chat finishes.
      if (isSuggestionsInFlightRef.current) {
        suggestionsPendingRef.current = true;
        suggestionsAbortRef.current?.abort();
      }

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

      const t0 = Date.now();
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
          const msg = errBody.error ?? "Chat request failed";
          setError(msg);
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
        const msg = e instanceof Error ? e.message : "Network error — check your connection.";
        setError(msg);
      } finally {
        // After a long chat, Groq needs proportional recovery time before handling
        // suggestions. A 20s chat → ~12s recovery; a 1s chat → ~0.6s (negligible).
        const chatDurationMs = Date.now() - t0;
        const postChatRecoveryMs = Math.min(Math.round(chatDurationMs * 0.6), 15000);
        lastSuggestionEndTimeRef.current = Date.now() + postChatRecoveryMs;

        isChatStreamingRef.current = false;
        setIsChatStreaming(false);
        setStreamingContent("");
        // Fire any suggestions that were deferred while chat was streaming.
        if (suggestionsPendingRef.current) {
          suggestionsPendingRef.current = false;
          queueMicrotask(() => generateSuggestionsRef.current?.());
        }
      }
    },
    []  // eslint-disable-line react-hooks/exhaustive-deps
  );

  // ── User types in chat box ────────────────────────────────────────────────

  const handleChatSend = useCallback(
    (text: string) => {
      if (isChatStreamingRef.current) return;
      const userMsg: ChatMessage = {
        id: genId(),
        role: "user",
        content: text,
        timestamp: Date.now(),
      };
      // Cap at last 10 messages (5 exchanges) — unbounded history balloons token count
      // over long sessions. Meeting context comes from the transcript in the system
      // prompt, not chat history, so capping history doesn't lose meeting awareness.
      const history = [
        ...chatMessages.slice(-10).map((m) => ({ role: m.role, content: m.content })),
        { role: "user" as const, content: text },
      ];
      streamChat(history, userMsg);
    },
    [chatMessages, streamChat]
  );

  // ── Suggestion card clicked ───────────────────────────────────────────────

  const handleSuggestionClick = useCallback(
    (suggestion: Suggestion) => {
      if (isChatStreamingRef.current) return;
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

      // Cap at last 10 messages and use short display content for prior turns.
      // Meeting context comes from the transcript embedded in detailedUserContent,
      // not from chat history, so capping doesn't lose meeting awareness.
      const history = [
        ...chatMessages.slice(-10).map((m) => ({ role: m.role, content: m.content })),
        { role: "user" as const, content: detailedUserContent },
      ];

      // transcriptAlreadyInMessage=true: detailed answer prompt already embeds the full transcript
      // so skip re-embedding it in the system prompt (avoids ~6000 words of duplicate context)
      streamChat(history, displayMsg, true);
    },
    [chatMessages, streamChat]
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
      {error && (
        <ErrorBanner key={error} message={error} onDismiss={() => setError(null)} />
      )}

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
            isQueued={isSuggestionsQueued}
            isTranscribing={isTranscribing}
            isRecording={isRecording}
            nextChunkIn={nextChunkIn}
            onRefresh={() => {
              setIsSuggestionsQueued(true);
              if (isRecording) {
                console.log("[reload] pressed while recording — setting force flag + flushChunk");
                forceNextSuggestionRef.current = true;
                flushChunk();
              } else {
                generateSuggestions(true);
              }
            }}
            onSuggestionClick={handleSuggestionClick}
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
