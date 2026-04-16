# TwinMind Live — AI Meeting Copilot

Real-time meeting intelligence: transcribes your mic, surfaces 3 context-aware AI suggestions every ~30 seconds, and streams detailed answers on demand.

**Live:** https://twinmind-live.vercel.app  
**Repo:** https://github.com/Shrayas555/twinmind-live-copilot

---

## Quick start

1. Open [twinmind-live.vercel.app](https://twinmind-live.vercel.app)
2. Click **Settings → API Key** → paste a Groq key (free at [console.groq.com](https://console.groq.com))
3. Click the mic button and start talking

No login, no `.env` file, no server-side storage. Your API key stays in your browser.

To run locally:

```bash
git clone https://github.com/Shrayas555/twinmind-live-copilot.git
cd twinmind-live
npm install
npm run dev   # → http://localhost:3000
```

---

## Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 16 (App Router) | API routes + React in one repo; one-command Vercel deploy |
| Language | TypeScript | Compile-time safety across all boundaries |
| Styling | Tailwind CSS | Dark UI without component library overhead |
| Transcription | Groq Whisper Large V3 | Best-in-class accuracy at low latency |
| AI | Groq `openai/gpt-oss-120b` | Assignment-required model; GPT-OSS 120B on Groq |
| Streaming | Server-Sent Events | First chat token in ~200ms from Groq |

---

## Architecture

```
app/
  page.tsx                 — orchestrator: all state, timers, event wiring
  api/transcribe/route.ts  — proxies audio blobs to Groq Whisper
  api/suggestions/route.ts — LLM call, returns 3 typed suggestion objects
  api/chat/route.ts        — SSE streaming chat endpoint

components/
  TranscriptPanel.tsx      — mic button, chunk list, auto-scroll
  SuggestionsPanel.tsx     — batched suggestion cards with type badges, collapse
  ChatPanel.tsx            — streaming chat with inline Markdown renderer
  SettingsModal.tsx        — tabbed: API key · models · prompts · context sizes

hooks/
  useAudioRecorder.ts      — MediaRecorder stop/restart chunking every N seconds
  useSettings.ts           — localStorage-backed settings with typed defaults

lib/
  types.ts                 — shared TypeScript interfaces
  prompts.ts               — default engineered prompts
  defaults.ts              — settings defaults, getContextWindow, formatTimestamp
```

### Audio chunking

`MediaRecorder` stops every 30 seconds (configurable), its `onstop` handler receives a complete `audio/webm` blob, sends it to `/api/transcribe`, then immediately restarts on the same stream. The mic indicator stays on throughout. The last partial chunk is captured when the user stops recording.

Blobs smaller than 1 KB are skipped — they are silence and cause Whisper errors.

### Suggestion generation strategy

Every time a transcript chunk arrives, suggestions regenerate. An independent 30-second timer also fires while recording as a fallback (decoupled from chunk timing).

**Context strategy — two-tier window:** The opening 60 words set meeting type ("Hi, this is Sarah from Acme…" → sales call). The recent 600 words are what's actionable right now. Both are sent together so the model has context for both "what kind of meeting" and "what just happened."

**Last exchange spotlight:** `getLastExchange()` extracts the last 4 sentences (80-word fallback for unpunctuated Whisper output) as a dedicated section. The model triages on this first — not a rolling average of the transcript.

**Skip-when-quiet:** Auto-refresh is skipped if fewer than 150 chars of new speech have been added since the last batch. Avoids wasted API calls during natural pauses while still firing the moment the conversation picks back up.

**Type selection:** The prompt gives the model five types — `QUESTION`, `TALKING_POINT`, `ANSWER`, `FACT_CHECK`, `CLARIFICATION` — and a decision tree for choosing the mix:
- Someone just asked a question → `ANSWER` takes priority
- Specific numbers or claims appeared → `FACT_CHECK` is high-value
- Technical vocabulary or acronyms → `CLARIFICATION`
- Open discussion with space to speak → `QUESTION` / `TALKING_POINT`

The model picks the mix that fits. Hard rule: if the last exchange contains a question, slot 1 is always `ANSWER`. Anti-repetition: the last 3 batches' previews are passed as `previousPreviews` — model is instructed to find fresh angles each time.

**Preview quality:** The prompt explicitly requires previews to deliver standalone value without clicking. Generic previews like "Ask about the timeline" are useless. Specific ones like "They mentioned Q3 delays — ask for the exact date and what's blocking them" are useful.

### Detailed answers on click

When a suggestion is clicked, a separate detailed-answer prompt is sent as the user turn (the chat panel shows the suggestion preview as the display text). The detailed prompt receives the full transcript context (up to 3000 words), the suggestion type, preview text, and the specific topic. Each type gets a different answer format:
- `QUESTION` → 2-3 follow-up questions with rationale + what a good answer looks like
- `ANSWER` → direct, complete answer with transcript references
- `FACT_CHECK` → correct/incorrect verdict + accurate figure + uncertainty flag
- `TALKING_POINT` → argument to make + supporting framing
- `CLARIFICATION` → definition + example tied to the conversation

### Chat

Streaming SSE. The system prompt gives the model the full transcript. All prior chat messages are included in every call, maintaining one continuous conversation per session.

---

## Prompt Engineering Decisions

**Why recency bias in the suggestions prompt:**
Meetings have a short attention window. What was said 10 minutes ago is usually resolved or irrelevant. Weighting the last 2-3 exchanges more heavily surfaces what the participant can actually act on in the next 30 seconds.

**Why `response_format: { type: "json_object" }` on the suggestions endpoint:**
Without it, the model occasionally wraps the JSON in prose ("Here are your suggestions: [...]"), breaking parsing. Enforced JSON eliminates this failure mode. The API route also handles both `[]` and `{ suggestions: [] }` shapes defensively.

**Why two separate prompts for suggestions vs. detailed answers:**
The context size, goal, and format are different. Suggestions: recent context, fast, punchy 130-char preview. Detailed answers: full transcript, structured with headers and bullets, thorough. One prompt trying to do both produces mediocre output at both.

**Why 600 words for suggestions context, 3000 for detailed answers:**
600 words ≈ 3 minutes of speech — the relevant window for what to surface right now. 3000 words gives the detailed answer model enough context to reference specifics from earlier in the meeting.

---

## Tradeoffs

**Stop/restart chunking vs timeslice:** I stop and restart MediaRecorder every N seconds rather than using `timeslice`. This gives Whisper a complete, well-formed audio file. The alternative (streaming PCM with VAD) is more accurate but introduces significant complexity and more failure modes.

**Client-side API key:** The key is stored in localStorage and sent in request bodies to Next.js API routes, which call Groq server-side. The key is never sent directly from the browser to Groq. For production you'd use server-side session storage — but for this scope it's the right tradeoff.

**No word-by-word transcript:** Whisper processes complete audio blobs. Real-time word-level streaming requires a different provider (Deepgram, AssemblyAI) or running Whisper locally with VAD. The 30-second chunk model matches the spec and TwinMind's existing product behavior.

---

## Session export

The **Export** button downloads a complete JSON file:
- Full transcript with timestamps
- Every suggestion batch (type + preview + detailPrompt)
- Full chat history: display content, full API content for suggestion clicks, suggestion type, timestamps
- Session metadata: duration, model names
