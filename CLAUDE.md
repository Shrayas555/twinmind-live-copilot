# TwinMind Live — Project Guide for Claude

## What this project is

A real-time AI meeting copilot: transcribes mic audio in 30-second chunks, surfaces 3 contextaware suggestions in the middle column, and streams detailed answers on demand in a chat panel.

## Layout (3-column, dark theme)

| Column | Component | Purpose |
|--------|-----------|---------|
| Left (1/3) | `TranscriptPanel` | Mic button, transcript chunks, word count, auto-scroll |
| Middle (1/3) | `SuggestionsPanel` | Batched suggestion cards, reload button, type legend |
| Right (1/3) | `ChatPanel` | Streaming chat, Markdown renderer, suggestion-click answers |

Header: Export button + Settings gear icon + DebugLog (bottom-right, collapsible).

## Tech stack

- **Next.js 16** App Router, TypeScript, Tailwind CSS
- **Groq Whisper Large V3** — audio transcription
- **Groq `openai/gpt-oss-120b`** — suggestions + chat
- **Vercel** — deployment (no env vars needed — key is user-supplied at runtime)
- **GitHub** — `Shrayas555/twinmind-live-copilot`

## File structure

```
app/page.tsx                    Orchestrator — all state, timers, event wiring
app/api/transcribe/route.ts     POST: audio blob → Groq Whisper → { text }
app/api/suggestions/route.ts    POST: transcript + prompt → Groq LLM → { suggestions[] }
app/api/chat/route.ts           POST: messages → Groq streaming SSE

components/TranscriptPanel.tsx  Mic button, chunk list, word count footer, auto-scroll
components/SuggestionsPanel.tsx Batched cards with type badges, type legend empty state
components/ChatPanel.tsx        Streaming chat + Markdown renderer (headers, bold, code, lists, hr)
components/SettingsModal.tsx    4 tabs: API Key · Models · Prompts · Context & Timing
components/ErrorBanner.tsx      Typed error display with rate-limit countdown
components/DebugLog.tsx         Collapsible API call log (latency + copy-all)

hooks/useAudioRecorder.ts       MediaRecorder stop/restart every N seconds
hooks/useSettings.ts            localStorage-persisted AppSettings, PROMPT_VERSION migration

lib/types.ts                    All shared TypeScript interfaces
lib/prompts.ts                  Engineered default prompts (suggestions, detailed answer, chat)
lib/defaults.ts                 DEFAULT_SETTINGS, getSuggestionsContext, getContextWindow
lib/groqError.ts                Groq error → user-readable message (status codes + fallback)
```

## How audio chunking works

`useAudioRecorder` stops MediaRecorder every `chunkDuration` seconds (default 30s, first chunk 15s),
sends the complete `audio/webm` blob to `/api/transcribe`, then immediately restarts on the same stream.
- First chunk capped at 15s so first suggestions appear quickly
- Same stream stays alive — no mic permission gap
- Blobs < 1 KB are skipped (silence / near-empty)
- Last partial chunk is captured when user stops recording

## How suggestions work

**Trigger:** every time a new transcript chunk arrives via `handleChunkTranscribed`.

**Context strategy — two-tier window:**
- `getSuggestionsContext()` sends opening 60 words (meeting type signal) + recent 600 words (recency)
- The latest `TranscriptChunk.text` is sent as `lastExchange` — it IS what was just said (15–30s of speech), no sentence parsing needed. `getLastExchange()` is only the fallback when no chunks exist yet.

**Output:** exactly 3 suggestions with `type`, `preview` (≤130 chars, standalone value), `detailPrompt`.

**Types:** `QUESTION` · `TALKING_POINT` · `ANSWER` · `FACT_CHECK` · `CLARIFICATION`

**Decision rules (enforced in system prompt):**
- Slot 1 = ANSWER if last exchange ends with a question — hard rule, non-negotiable
- FACT_CHECK when specific numbers/statistics appear
- CLARIFICATION when jargon/acronyms appear
- Slot 3 = "outsider angle" — what a domain expert who just walked in would notice

**JSON reliability:** uses `stream: true` (not `response_format: json_object`) — Groq's strict
JSON validation fails intermittently on `openai/gpt-oss-120b`. We accumulate tokens and parse
with a robust `indexOf/lastIndexOf` extractor. `OUTPUT RULE` at the end of the system prompt
enforces that the first character must be `{`.

**Anti-repetition:** last batch's previews sent as `previousPreviews` — used server-side only
for deduplication after generation. The model never sees them; `{previousSuggestionsBlock}` is
replaced with "" in the user template.

**Concurrency:** `isSuggestionsInFlightRef` prevents concurrent calls. If a new chunk arrives
mid-flight, `suggestionsPendingRef` queues a follow-up via `queueMicrotask`.

**Timeout:** `runStream` uses `Promise.race`. Initial call: 10s timeout, temp=0.7. Two retry paths:
- Timeout (empty content) → retry at temp=0.5, 7s
- Fast parse failure (<5s elapsed) → retry at temp=0.3, 5s
A slow timeout does not trigger the fast-failure retry — no double-wait.

## How suggestion clicks work

- Display text in chat: `suggestion.preview` (short, what the user sees)
- Actual API content: the full `detailedAnswerPrompt` expanded with transcript + type + preview + detailPrompt
- Previous chat turns use display content (not apiContent) to prevent token explosion
- `transcriptAlreadyInMessage=true` skips re-embedding the transcript in the system prompt

## How chat streaming works

`/api/chat` returns Server-Sent Events. Client reads stream, appends `delta` tokens to
`streamingContent` state in real time. `[DONE]` commits the full message to `chatMessages`.

## Settings (all configurable at runtime)

| Setting | Default | Purpose |
|---------|---------|---------|
| `groqApiKey` | `""` | Stored in localStorage, sent in request bodies (never browser→Groq directly) |
| `transcriptionModel` | `whisper-large-v3` | Groq Whisper model |
| `suggestionsModel` | `openai/gpt-oss-120b` | LLM for suggestions |
| `chatModel` | `openai/gpt-oss-120b` | LLM for chat |
| `suggestionsPrompt` | see `lib/prompts.ts` | Combined system + `---USER TEMPLATE---` + user template |
| `detailedAnswerPrompt` | see `lib/prompts.ts` | Variables: `{transcript}` `{type}` `{preview}` `{detailPrompt}` |
| `chatSystemPrompt` | see `lib/prompts.ts` | Variable: `{transcript}` |
| `suggestionsContextWords` | `600` | Recent words sent for suggestions |
| `detailedAnswerContextWords` | `3000` | Words sent for detailed answers / chat |
| `autoRefreshInterval` | `30` | Chunk duration in seconds (also controls auto-refresh cadence) |

## Key design decisions

1. **600-word context for suggestions** — recency bias; last ~3 min of speech is actionable now
2. **Separate prompts for suggestions vs detailed answers** — different context size, format, goal
3. **Latest Whisper chunk as lastExchange** — no sentence parsing errors across chunk joins
4. **Stop/restart chunking over timeslice** — Whisper needs complete audio files; simpler + reliable
5. **stream:true over response_format:json_object** — avoids Groq's intermittent json_validate_failed
6. **Preview must deliver standalone value** — enforced by prompt quality bar with good/bad examples
7. **Slot 3 = outsider angle** — hard-coded asymmetry produces more varied batches than 3 equal slots

## Security

- No hardcoded API keys anywhere
- `.gitignore` covers all `.env*` files
- API key stored in localStorage only; routed through Next.js API routes server-side
- No user data persisted on any server
