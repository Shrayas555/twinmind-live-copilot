import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";
import {
  DEFAULT_SUGGESTIONS_SYSTEM,
  DEFAULT_SUGGESTIONS_USER_TEMPLATE,
  DEFAULT_SUGGESTIONS_PROMPT,
} from "@/lib/prompts";
import { GROQ_SUGGESTIONS_MODEL, genId } from "@/lib/defaults";
import type { Suggestion, SuggestionType } from "@/lib/types";
import { parseGroqError, groqErrorStatus } from "@/lib/groqError";

interface SuggestionRaw {
  type: string;
  preview: string;
  detailPrompt: string;
}

const VALID_TYPES: SuggestionType[] = [
  "QUESTION",
  "TALKING_POINT",
  "ANSWER",
  "FACT_CHECK",
  "CLARIFICATION",
];

// Minimum words before generating suggestions — set low so the first 15s chunk
// (which may have only 5-10 words if the user started speaking mid-chunk) still fires.
const MIN_TRANSCRIPT_WORDS = 5;

function buildPreviousSuggestionsBlock(previousPreviews: string[]): string {
  if (!previousPreviews.length) return "";
  // Inline format — NOT a numbered list. Numbered lists bleed into the model's output
  // style and cause it to write reasoning prose instead of JSON.
  const quoted = previousPreviews.map((p) => `"${p}"`).join(" · ");
  return `SKIP (already shown to user — do not repeat): ${quoted}\n\n`;
}

/**
 * The settings-editable "systemPrompt" field is a combined string
 * (system + "---USER TEMPLATE---" + user template). Split it here.
 * Falls back to defaults if the separator isn't present (e.g. custom prompts).
 */
function splitPrompt(combinedPrompt: string): { system: string; userTemplate: string } {
  const SEP = "---USER TEMPLATE---";
  const idx = combinedPrompt.indexOf(SEP);
  if (idx === -1) {
    return { system: DEFAULT_SUGGESTIONS_SYSTEM, userTemplate: combinedPrompt };
  }
  return {
    system: combinedPrompt.slice(0, idx).trim(),
    userTemplate: combinedPrompt.slice(idx + SEP.length).trim(),
  };
}

/**
 * Robustly extracts a SuggestionRaw[] from model output.
 *
 * Uses indexOf/lastIndexOf instead of regex for JSON boundary detection —
 * regex with non-greedy `*?` stops at the first `]` it finds, which breaks
 * when preview text contains square brackets (e.g. the system prompt's own
 * QUESTION example: "How long on [vendor]..."). indexOf/lastIndexOf finds the
 * true outermost boundaries regardless of bracket characters inside strings.
 *
 * Handles: plain JSON object with suggestions key, plain JSON array,
 * JSON embedded in prose, JSON wrapped in markdown code fences.
 */
function extractSuggestions(text: string): SuggestionRaw[] {
  if (!text?.trim()) return [];

  // Strip markdown code fences — model sometimes outputs ```json ... ```
  const cleaned = text
    .replace(/^```(?:json|JSON)?\s*\n?/m, "")
    .replace(/\n?```\s*$/m, "")
    .trim();

  // 1. Try direct parse of the cleaned text
  try {
    const outer = JSON.parse(cleaned);
    if (Array.isArray(outer)) return outer;
    if (Array.isArray(outer.suggestions)) return outer.suggestions;
    if (Array.isArray(outer.data)) return outer.data;
  } catch { /* fall through */ }

  // 2. Find outermost JSON object via indexOf/lastIndexOf — handles ] or } in string values.
  //    Try object before array because the prompt instructs {"suggestions": [...]} format.
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      const obj = JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
      if (Array.isArray(obj.suggestions)) return obj.suggestions;
      if (Array.isArray(obj.data)) return obj.data;
      if (Array.isArray(obj)) return obj;
    } catch { /* fall through */ }
  }

  // 3. Find outermost JSON array via indexOf/lastIndexOf (fallback for bare arrays)
  const firstBracket = cleaned.indexOf("[");
  const lastBracket = cleaned.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    try {
      const arr = JSON.parse(cleaned.slice(firstBracket, lastBracket + 1));
      if (Array.isArray(arr)) return arr;
    } catch { /* fall through */ }
  }

  return [];
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { transcript, lastExchange, systemPrompt, apiKey, model, previousPreviews } = body as {
      transcript: string;
      lastExchange?: string;
      systemPrompt: string;
      apiKey: string;
      model?: string;
      previousPreviews?: string[];
    };

    if (!transcript?.trim()) {
      return NextResponse.json({ error: "No transcript provided" }, { status: 400 });
    }
    if (!apiKey) {
      return NextResponse.json({ error: "No API key provided" }, { status: 400 });
    }

    const wordCount = transcript.trim().split(/\s+/).length;
    if (wordCount < MIN_TRANSCRIPT_WORDS) {
      return NextResponse.json({ suggestions: [] });
    }

    const groq = new Groq({ apiKey });

    const previousSuggestionsBlock = buildPreviousSuggestionsBlock(previousPreviews ?? []);
    const { system, userTemplate } = splitPrompt(systemPrompt ?? DEFAULT_SUGGESTIONS_PROMPT);

    // Append SKIP constraint to the system prompt — NOT the user message.
    // In the user message it bleeds into the model's output style and causes JSON parse failures.
    const systemWithContext = previousSuggestionsBlock
      ? system + "\n\n" + previousSuggestionsBlock.trim()
      : system;

    const userMessage = (userTemplate || DEFAULT_SUGGESTIONS_USER_TEMPLATE)
      .replace("{transcript}", transcript)
      .replace("{lastExchange}", lastExchange ?? transcript.split(/\s+/).slice(-60).join(" "))
      .replace("{previousSuggestionsBlock}", "");

    const llmMessages: { role: "system" | "user"; content: string }[] = [
      { role: "system", content: systemWithContext },
      { role: "user", content: userMessage },
    ];
    const llmModel = model || GROQ_SUGGESTIONS_MODEL;

    // Hard-timeout wrapper using Promise.race — AbortController alone doesn't reliably
    // cancel mid-stream on the Groq SDK; race guarantees the caller gets "" within timeoutMs.
    // Timer is cleared in finally so it doesn't leak when exec wins the race.
    async function runStream(temperature: number, timeoutMs: number): Promise<string> {
      const abort = new AbortController();
      let timer: ReturnType<typeof setTimeout> | null = null;

      const exec = async (): Promise<string> => {
        // stream:true avoids Groq's json_validate_failed (400) on openai/gpt-oss-120b
        const stream = await groq.chat.completions.create(
          { model: llmModel, messages: llmMessages, temperature, max_tokens: 600, stream: true },
          { signal: abort.signal }
        );
        let raw = "";
        for await (const chunk of stream) {
          if (abort.signal.aborted) break;
          raw += chunk.choices[0]?.delta?.content ?? "";
        }
        return raw;
      };

      const timeout = new Promise<string>((resolve) => {
        timer = setTimeout(() => { abort.abort(); resolve(""); }, timeoutMs);
      });

      try {
        return await Promise.race([exec(), timeout]);
      } catch (e) {
        if (abort.signal.aborted) return "";
        throw e;
      } finally {
        if (timer !== null) clearTimeout(timer);
      }
    }

    const t0 = Date.now();
    let rawContent = await runStream(0.65, 7000);
    const elapsed = Date.now() - t0;
    let parsed = extractSuggestions(rawContent);

    // Retry once at lower temperature only on fast parse failures (<5s).
    // If the first attempt timed out (elapsed ~7s), retrying would just double the wait.
    if (!parsed.length && elapsed < 5000) {
      console.warn("[suggestions] Parse failed, retrying at temperature 0.3");
      rawContent = await runStream(0.3, 5000);
      parsed = extractSuggestions(rawContent);
    }

    if (!parsed.length) {
      console.error("[suggestions] JSON extraction failed. Raw output:", rawContent.slice(0, 400));
      return NextResponse.json({ suggestions: [], parseError: true });
    }

    const suggestions: Suggestion[] = parsed
      .slice(0, 3)
      .map((s) => ({
        id: genId(),
        type: (VALID_TYPES.includes(s.type as SuggestionType)
          ? s.type
          : "QUESTION") as SuggestionType,
        preview: (s.preview ?? "").trim(),
        detailPrompt: (s.detailPrompt ?? s.preview ?? "").trim(),
        timestamp: Date.now(),
      }))
      .filter((s) => s.preview.length > 0);

    return NextResponse.json({ suggestions });
  } catch (err: unknown) {
    const message = parseGroqError(err);
    const status = groqErrorStatus(err);
    console.error("[suggestions]", message);
    return NextResponse.json({ error: message }, { status });
  }
}
