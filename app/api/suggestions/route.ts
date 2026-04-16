import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";
import { GROQ_SUGGESTIONS_MODEL } from "@/lib/defaults";
import type { Suggestion, SuggestionType } from "@/lib/types";
import { genId } from "@/lib/defaults";

interface SuggestionRaw {
  type: string;
  preview: string;
  detailPrompt: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { transcript, systemPrompt, apiKey, model } = body as {
      transcript: string;
      systemPrompt: string;
      apiKey: string;
      model?: string;
    };

    if (!transcript?.trim()) {
      return NextResponse.json({ error: "No transcript provided" }, { status: 400 });
    }
    if (!apiKey) {
      return NextResponse.json({ error: "No API key provided" }, { status: 400 });
    }

    const groq = new Groq({ apiKey });

    const prompt = systemPrompt.replace("{transcript}", transcript);

    const completion = await groq.chat.completions.create({
      model: model || GROQ_SUGGESTIONS_MODEL,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.7,
      max_tokens: 1024,
      response_format: { type: "json_object" },
    });

    const raw = completion.choices[0]?.message?.content ?? "[]";

    // The model returns either an array directly or wrapped in an object
    let parsed: SuggestionRaw[];
    try {
      const outer = JSON.parse(raw);
      parsed = Array.isArray(outer) ? outer : (outer.suggestions ?? outer.data ?? []);
    } catch {
      console.error("[suggestions] Failed to parse JSON:", raw);
      return NextResponse.json({ error: "Invalid JSON from model" }, { status: 500 });
    }

    const VALID_TYPES: SuggestionType[] = [
      "QUESTION",
      "TALKING_POINT",
      "ANSWER",
      "FACT_CHECK",
      "CLARIFICATION",
    ];

    const suggestions: Suggestion[] = parsed
      .slice(0, 3)
      .map((s) => ({
        id: genId(),
        type: (VALID_TYPES.includes(s.type as SuggestionType)
          ? s.type
          : "QUESTION") as SuggestionType,
        preview: s.preview ?? "",
        detailPrompt: s.detailPrompt ?? s.preview ?? "",
        timestamp: Date.now(),
      }))
      .filter((s) => s.preview.length > 0);

    return NextResponse.json({ suggestions });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Suggestions failed";
    console.error("[suggestions]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
