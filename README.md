# TwinMind Live — AI Meeting Copilot

Real-time meeting intelligence: transcribes your mic, surfaces 3 context-aware suggestions every ~30 seconds, and streams detailed answers on demand.

**Live:** https://twinmind-live.vercel.app  
**Repo:** https://github.com/Shrayas555/twinmind-live-copilot

---

## Quick start

1. Open [twinmind-live.vercel.app](https://twinmind-live.vercel.app)
2. Click **Settings → API Key** → paste a Groq key (free at [console.groq.com](https://console.groq.com))
3. Click the mic and start talking — first suggestions appear within ~17 seconds

No login. No `.env` file. No server-side storage. Your API key stays in your browser.

To run locally:

```bash
git clone https://github.com/Shrayas555/twinmind-live-copilot.git
cd twinmind-live
npm install
npm run dev   # → http://localhost:3000
```

---

## Deploy

No server-side secrets — users paste their own Groq key in the app.

```bash
cd twinmind-live
npx vercel deploy --prod
```

Leave **Environment Variables** empty on Vercel. The key is user-supplied at runtime.

---

## Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 16 (App Router) | API routes + React in one repo; zero-config Vercel deploy |
| Language | TypeScript | Compile-time safety across all API boundaries |
| Styling | Tailwind CSS | Dark UI without a component library |
| Transcription | Groq Whisper Large V3 | Best accuracy at low latency |
| AI | Groq `openai/gpt-oss-120b` | GPT-OSS 120B on Groq infrastructure |
| Streaming | Server-Sent Events | First chat token in ~200ms |

---

## Architecture

```
app/
  page.tsx                 Orchestrator — all state, timers, event wiring
  api/transcribe/route.ts  POST: audio blob → Groq Whisper → { text }
  api/suggestions/route.ts POST: transcript → Groq LLM → { suggestions[3] }
  api/chat/route.ts        POST: messages → Groq streaming SSE

components/
  TranscriptPanel.tsx      Mic button, chunk list, word count, auto-scroll
  SuggestionsPanel.tsx     Suggestion cards with type badges, type legend
  ChatPanel.tsx            Streaming chat, Markdown renderer
  SettingsModal.tsx        API key · models · prompts · context sizes
  ErrorBanner.tsx          Typed errors with rate-limit countdown

hooks/
  useAudioRecorder.ts      MediaRecorder stop/restart every N seconds
  useSettings.ts           localStorage settings with version-based migration

lib/
  types.ts                 Shared TypeScript interfaces
  prompts.ts               Engineered default prompts
  defaults.ts              Settings defaults, context helpers
  groqError.ts             Groq error → user-readable messages
```

### Audio chunking

`MediaRecorder` stops every 30 seconds (configurable), its `onstop` handler receives a complete `audio/webm` blob, sends it to `/api/transcribe`, then immediately restarts on the same stream. The mic indicator stays on throughout. The last partial chunk is captured when the user stops.

- First chunk capped at **15 seconds** so the first suggestions appear quickly
- Blobs < 1 KB are skipped — silence causes Whisper errors

### Suggestion generation

Every time a transcript chunk arrives, three suggestions are generated. The middle column shows a live countdown to the next chunk.

**Two-tier context window:** The opening 60 words establish meeting type ("Hi, I'm Sarah from Acme…" → sales call). The recent 600 words are what's actionable right now. Both are sent together.

**Last exchange spotlight:** The latest Whisper chunk is sent as a dedicated `lastExchange` section — it IS what was said in the last 15–30 seconds, no sentence parsing. The model triages on this section first, not a rolling average.

**Anti-repetition:** The last batch's previews are sent as `previousPreviews` to the server, which filters out any suggestion whose preview exactly matches one already shown. The model itself doesn't see the list — deduplication happens server-side after generation.

**Concurrency lock:** A ref-based lock (`isSuggestionsInFlightRef`) prevents concurrent Groq calls. If a new chunk arrives mid-flight, `suggestionsPendingRef` queues a follow-up via `queueMicrotask` — no refresh is ever lost.

**Timeout:** The initial stream attempt has a 10-second hard timeout via `Promise.race`. Two retry paths:
- **Timeout** (empty content): retry at `temperature=0.5`, 7s timeout — Groq was momentarily busy
- **Fast parse failure** (<5s, non-JSON output): retry at `temperature=0.3`, 5s timeout

A slow timeout does not trigger the fast-failure retry — no double-wait.

### Suggestion types

| Type | When | What it delivers |
|---|---|---|
| `ANSWER` | Question was just asked | Direct answer, ready to say |
| `QUESTION` | Open discussion, no recent question | Verbatim question to ask right now |
| `TALKING_POINT` | Key argument being missed | Core point + one supporting fact |
| `FACT_CHECK` | Specific number or claim stated | What was claimed vs. what is actually true |
| `CLARIFICATION` | Jargon or ambiguous term appeared | Definition + why alignment matters here |

**Slot assignment rules (enforced in system prompt):**
- Slot 1: ANSWER if the last exchange contains a question — non-negotiable
- Slot 2: deepens or advances the conversation
- Slot 3: the "outsider angle" — what a domain expert who just walked in would notice that the participant is too close to see

### Detailed answers on click

Clicking a card sends a separate, longer-form prompt with up to 3000 words of transcript context. Each type gets a different structure:

- **ANSWER** → direct answer in bold + supporting points + "Say exactly:" + "Don't say:"
- **QUESTION** → verbatim question + rationale + what a strong vs. evasive answer looks like + "If they dodge:"
- **TALKING_POINT** → core argument + framing + likely pushback + one-line response
- **FACT_CHECK** → exact claim quoted + what is actually true + how to raise it gracefully
- **CLARIFICATION** → plain-English definition + example tied to this conversation

### Chat

Streaming SSE. The system prompt gives the model the full transcript. All prior messages are included in every call — one continuous conversation per session.

---

## Prompt Engineering Decisions

**Why the latest Whisper chunk is used as `lastExchange`:**
Sentence boundaries across Whisper chunk joins are unreliable — parsing them splits mid-thought. The latest `TranscriptChunk.text` IS what was just said in the last 15–30 seconds, no parsing needed.

**Why three asymmetric slots:**
Slot 1 is always the most urgent. Slot 2 advances the conversation. Slot 3 is explicitly the "outsider angle" — hard-coded asymmetry produces more varied, higher-value batches than three equal slots.

**Why `stream: true` instead of `response_format: json_object`:**
Groq validates `response_format: json_object` output strictly — `openai/gpt-oss-120b` intermittently fails this validation even when the output is valid JSON (`json_validate_failed`). With `stream: true`, Groq skips strict validation; we accumulate tokens and parse with a robust `indexOf/lastIndexOf` extractor that handles brackets inside string values.

**Why `OUTPUT RULE` at the end of the system prompt:**
`openai/gpt-oss-120b` sometimes outputs reasoning prose before the JSON, especially when the numbered list in prior suggestions bleeds into the model's output style. Putting a hard rule as the final instruction (`first character must be {`) overrides that tendency.

**Why two separate prompts for suggestions vs. detailed answers:**
Context size, goal, and format are fundamentally different. Suggestions: 600-word context, fast, punchy 130-char preview. Detailed answers: 3000-word context, structured with headers and bullets. One prompt for both produces mediocre output at both.

**Why 600 words for suggestions, 3000 for detailed answers:**
600 words ≈ 3 minutes of speech — the relevant window for what to surface right now. 3000 words gives the detailed answer model enough context to reference specifics from earlier in the meeting.

---

## Tradeoffs

**Stop/restart chunking vs. timeslice:** Stopping and restarting MediaRecorder gives Whisper a complete, well-formed audio file every time. `timeslice` streams raw PCM — more accurate but requires VAD, more failure modes, significantly more complexity.

**Client-side API key:** Stored in localStorage and sent in request bodies to Next.js API routes, which call Groq server-side. The key never travels browser → Groq directly. For production you'd use server-side sessions — for this scope it's the right tradeoff.

**No word-by-word transcript:** Whisper processes complete audio blobs. Real-time word-level streaming requires a different provider (Deepgram, AssemblyAI) or local Whisper with VAD. The 30-second chunk model is simpler and produces accurate, complete sentences.

**Reload while recording:** Pressing the refresh button calls `flushChunk()`, which stops the current MediaRecorder early. `onstop` fires, the partial audio is transcribed by Whisper, and `handleChunkTranscribed` then triggers suggestion generation. There is no parallel immediate generation — the single batch arrives after the flush-transcribe cycle completes.

---

## Session export

The **Export** button downloads a complete JSON file:
- Full transcript with timestamps
- Every suggestion batch (type + preview + detailPrompt)
- Full chat history: display content, full API prompt for suggestion clicks, suggestion type, timestamps
- Session metadata: duration, model names

