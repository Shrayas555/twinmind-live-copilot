# TwinMind Live Suggestions — Project Guide

## What this project is

A take-home assignment for a Full Stack / Prompt Engineer role at TwinMind (Menlo Park, CA).
TwinMind is an always-on AI meeting copilot. This app replicates and improves their core feature:
surfacing the right suggestion at the right time during a live conversation.

The app is evaluated on:
1. **Prompt engineering quality** — useful, well-timed, contextually varied suggestions
2. **Chat answer quality** — detailed answers when a suggestion is clicked
3. **Full-stack engineering** — audio, API routes, streaming, error handling
4. **Code quality** — clean structure, readable, no dead code
5. **Latency** — first suggestion render speed, first chat token speed

## Layout (3-column, dark theme)

| Column | Component | Purpose |
|--------|-----------|---------|
| Left (1/3) | `TranscriptPanel` | Mic button, transcript chunks, auto-scroll |
| Middle (1/3) | `SuggestionsPanel` | Batched suggestion cards, auto-refresh, reload button |
| Right (1/3) | `ChatPanel` | Streaming chat, suggestion-click answers |

Header: Export button + Settings gear icon.

## Tech stack

- **Next.js 16** App Router, TypeScript, Tailwind CSS
- **Groq Whisper Large V3** — audio transcription
- **Groq `meta-llama/llama-4-maverick-17b-128e-instruct`** — suggestions + chat (GPT-OSS 120B)
- **Vercel** — deployment
- **GitHub** — `Shrayas555/twinmind-live-copilot` (public repo)

## File structure

```
app/page.tsx                    Main orchestrator — all state, timers, event wiring
app/api/transcribe/route.ts     POST: proxies audio blob → Groq Whisper, returns { text }
app/api/suggestions/route.ts    POST: transcript + prompt → Groq LLM, returns { suggestions[] }
app/api/chat/route.ts           POST: messages → Groq streaming SSE

components/TranscriptPanel.tsx  Mic button (start/stop), chunk list, auto-scroll
components/SuggestionsPanel.tsx Batched cards with type badges, collapsible, refresh button
components/ChatPanel.tsx        Streaming chat, minimal Markdown renderer (bold + bullets)
components/SettingsModal.tsx    4 tabs: API Key · Models · Prompts · Context & Timing

hooks/useAudioRecorder.ts       MediaRecorder stop/restart every N seconds, transcribes each chunk
hooks/useSettings.ts            localStorage-persisted AppSettings with typed defaults

lib/types.ts                    All shared TypeScript types
lib/prompts.ts                  Default engineered prompts (suggestions, detailed answer, chat)
lib/defaults.ts                 DEFAULT_SETTINGS, getContextWindow, formatTimestamp, genId
```

## How audio chunking works

`useAudioRecorder` stops MediaRecorder every `chunkDuration` seconds, sends the complete
`audio/webm` blob to `/api/transcribe`, then immediately restarts on the same stream.
- Same stream stays alive so there's no mic permission gap
- Each blob is a complete audio file (Whisper needs this)
- Blobs < 1 KB are skipped (silence)
- Last partial chunk is captured when user stops recording

## How suggestions work

- Trigger: every time a new transcript chunk arrives + independent 30s timer while recording
- Context: last 500 words of transcript (recency matters; full context dilutes signal)
- Output: exactly 3 suggestions, each with `type`, `preview` (≤130 chars, standalone value), `detailPrompt`
- Types: `QUESTION` `TALKING_POINT` `ANSWER` `FACT_CHECK` `CLARIFICATION`
- JSON enforced via `response_format: { type: "json_object" }` on Groq
- API route handles both `[]` and `{ suggestions: [] }` response shapes

## How suggestion clicks work

Clicking a card uses the **detailed answer prompt** (separate from suggestions prompt).
- Display: shows suggestion preview as the user turn in chat
- API call: sends the full detailed prompt as the actual user message content
- Context: up to 3000 words of transcript
- Each type gets a different answer structure (ANSWER → direct answer, FACT_CHECK → verdict + correct figure, etc.)

## How chat streaming works

`/api/chat` returns Server-Sent Events. The client reads the stream and appends `delta` tokens
to `streamingContent` state in real time. When `[DONE]` arrives, the complete message is
committed to `chatMessages` state.

## Settings (all configurable at runtime)

| Setting | Default | Purpose |
|---------|---------|---------|
| groqApiKey | "" | Stored in localStorage, passed in request bodies |
| transcriptionModel | `whisper-large-v3` | Groq Whisper model |
| suggestionsModel | `meta-llama/llama-4-maverick-17b-128e-instruct` | LLM for suggestions |
| chatModel | same | LLM for chat |
| suggestionsSystemPrompt | see lib/prompts.ts | Full prompt with `{transcript}` placeholder |
| detailedAnswerPrompt | see lib/prompts.ts | `{transcript}` `{type}` `{preview}` `{detailPrompt}` |
| chatSystemPrompt | see lib/prompts.ts | `{transcript}` placeholder |
| suggestionsContextWords | 500 | Words of transcript sent for suggestions |
| detailedAnswerContextWords | 3000 | Words sent for detailed answers / chat |
| autoRefreshInterval | 30 | Seconds between auto-refresh + audio chunk size |

## Key design decisions to defend in interview

1. **500-word context for suggestions** — recency bias; last ~2 min of speech is what's actionable now
2. **Separate prompts for suggestions vs detailed answers** — different context size, different output format
3. **Stop/restart chunking** — gives Whisper complete audio files; simpler and more reliable than timeslice
4. **API key in localStorage → request body** — user pastes their own key; routes call Groq server-side so key never goes browser→Groq directly
5. **Type heuristics in prompt** — model picks the mix; ANSWER prioritized when question just asked, FACT_CHECK when numbers appear
6. **Preview must deliver standalone value** — this is the hardest prompt constraint; generic previews are worthless

## Security

- No hardcoded API keys anywhere
- .gitignore covers all .env* files
- API key only in localStorage and request bodies (server-proxied)
- No user data persisted on any server

## Deployment

- GitHub: `https://github.com/Shrayas555/twinmind-live-copilot` (public)
- Deploy target: Vercel (`vercel --prod`)
- No environment variables needed on Vercel (key is user-supplied at runtime)
