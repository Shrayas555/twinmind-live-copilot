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

// Minimum words before we bother generating suggestions — avoids garbage on thin context
const MIN_TRANSCRIPT_WORDS = 40;

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
    // Custom prompt — treat the whole thing as the user message, use default system
    return { system: DEFAULT_SUGGESTIONS_SYSTEM, userTemplate: combinedPrompt };
  }
  return {
    system: combinedPrompt.slice(0, idx).trim(),
    userTemplate: combinedPrompt.slice(idx + SEP.length).trim(),
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { transcript, lastExchange, systemPrompt, apiKey, model, previousPreviews } = body as {
      transcript: string;
      lastExchange?: string; // last 3-4 sentences — explicit triage spotlight
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

    // Don't waste an API call on a thin transcript — suggestions would be generic
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

    const completion = await groq.chat.completions.create({
      model: model || GROQ_SUGGESTIONS_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userMessage },
      ],
      temperature: 0.65,
      max_tokens: 600,
      response_format: { type: "json_object" },
    });

    const raw = completion.choices[0]?.message?.content ?? "[]";

    let parsed: SuggestionRaw[];
    try {
      const outer = JSON.parse(raw);
      parsed = Array.isArray(outer) ? outer : (outer.suggestions ?? outer.data ?? []);
    } catch {
      console.error("[suggestions] Failed to parse JSON:", raw);
      return NextResponse.json({ error: "Invalid JSON from model" }, { status: 500 });
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
