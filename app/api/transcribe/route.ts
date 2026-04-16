import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";
import { GROQ_TRANSCRIPTION_MODEL } from "@/lib/defaults";
import { parseGroqError, groqErrorStatus } from "@/lib/groqError";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const audio = formData.get("audio") as File | null;
    const apiKey = formData.get("apiKey") as string | null;
    const model = (formData.get("model") as string) || GROQ_TRANSCRIPTION_MODEL;

    if (!audio) {
      return NextResponse.json({ error: "No audio file provided" }, { status: 400 });
    }
    if (!apiKey) {
      return NextResponse.json({ error: "No API key provided" }, { status: 400 });
    }
    if (audio.size < 1000) {
      // Skip very small blobs (silence / near-empty recordings)
      return NextResponse.json({ text: "" });
    }

    const groq = new Groq({ apiKey });

    // Groq's Whisper endpoint expects a file-like object
    const transcription = await groq.audio.transcriptions.create({
      file: audio,
      model,
      response_format: "json",
      language: "en",
    });

    return NextResponse.json({ text: transcription.text });
  } catch (err: unknown) {
    const message = parseGroqError(err);
    const status = groqErrorStatus(err);
    console.error("[transcribe]", message);
    return NextResponse.json({ error: message }, { status });
  }
}
