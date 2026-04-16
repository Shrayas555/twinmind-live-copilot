import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";
import {
  GROQ_SUGGESTIONS_MODEL,
  DEFAULT_SUGGESTIONS_SYSTEM,
  DEFAULT_SUGGESTIONS_USER_TEMPLATE,
} from "@/lib/defaults";
import type { Suggestion, SuggestionType } from "@/lib/types";
import { genId } from "@/lib/defaults";
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

// Minimum words before generating suggestions — 30s of typical speech ≈ 35-40 words;
// set to 20 so slow speakers still get suggestions after the first chunk
const MIN_TRANSCRIPT_WORDS = 20;

function buildPreviousSuggestionsBlock(previousPreviews: string[]): string {
  if (!previousPreviews.length) return "";
  const items = previousPreviews.map((p) => `• ${p}`).join("\n");
  return `ALREADY SURFACED — do NOT repeat these angles, find fresh ones:\n${items}\n\n`;
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
 * Handles: plain JSON array, {suggestions:[]} wrapper, JSON embedded in prose,
 * and the failed_generation field Groq returns on json_validate_failed errors.
 */
function extractSuggestions(text: string): SuggestionRaw[] {
  if (!text?.trim()) return [];

  // 1. Try direct parse
  try {
    const outer = JSON.parse(text);
    if (Array.isArray(outer)) return outer;
    if (Array.isArray(outer.suggestions)) return outer.suggestions;
    if (Array.isArray(outer.data)) return outer.data;
  } catch { /* fall through */ }

  // 2. Find and parse the first JSON array in the text (model wrapped in prose)
  const arrayMatch = text.match(/\[[\s\S]*?\]/);
  if (arrayMatch) {
    try {
      const arr = JSON.parse(arrayMatch[0]);
      if (Array.isArray(arr)) return arr;
    } catch { /* fall through */ }
  }

  // 3. Find and parse the first JSON object (might contain suggestions key)
  const objectMatch = text.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    try {
      const obj = JSON.parse(objectMatch[0]);
      if (Array.isArray(obj.suggestions)) return obj.suggestions;
      if (Array.isArray(obj.data)) return obj.data;
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
    const { system, userTemplate } = splitPrompt(systemPrompt ?? DEFAULT_SUGGESTIONS_SYSTEM);

    const userMessage = (userTemplate || DEFAULT_SUGGESTIONS_USER_TEMPLATE)
      .replace("{transcript}", transcript)
      .replace("{lastExchange}", lastExchange ?? transcript.split(/\s+/).slice(-60).join(" "))
      .replace("{previousSuggestionsBlock}", previousSuggestionsBlock);

    let rawContent: string;

    try {
      const completion = await groq.chat.completions.create({
        model: model || GROQ_SUGGESTIONS_MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userMessage },
        ],
        temperature: 0.65,
        max_tokens: 700,
        response_format: { type: "json_object" },
      });
      rawContent = completion.choices[0]?.message?.content ?? "";
    } catch (apiErr: unknown) {
      // Groq returns 400 json_validate_failed when the model output passes the LLM
      // but fails Groq's JSON validator. The partial output is in failed_generation —
      // try to recover usable suggestions from it before giving up.
      if (
        apiErr instanceof Groq.APIError &&
        apiErr.status === 400 &&
        (apiErr.error as { code?: string })?.code === "json_validate_failed"
      ) {
        const failedGen = (apiErr.error as { failed_generation?: string })?.failed_generation ?? "";
        console.warn("[suggestions] json_validate_failed — recovering from failed_generation");
        rawContent = failedGen;
      } else {
        throw apiErr;
      }
    }

    const parsed = extractSuggestions(rawContent);

    if (!parsed.length) {
      console.error("[suggestions] Could not extract suggestions from:", rawContent.slice(0, 300));
      return NextResponse.json({ suggestions: [] });
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
