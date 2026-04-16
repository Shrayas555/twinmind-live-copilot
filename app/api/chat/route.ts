import { NextRequest } from "next/server";
import Groq from "groq-sdk";
import { GROQ_CHAT_MODEL } from "@/lib/defaults";
import { parseGroqError, groqErrorStatus } from "@/lib/groqError";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { messages, systemPrompt, transcript, apiKey, model } = body as {
      messages: { role: "user" | "assistant"; content: string }[];
      systemPrompt: string;
      transcript: string;
      apiKey: string;
      model?: string;
    };

    if (!apiKey) {
      return new Response(JSON.stringify({ error: "No API key" }), { status: 400 });
    }
    if (!messages?.length) {
      return new Response(JSON.stringify({ error: "No messages provided" }), { status: 400 });
    }
    if (!systemPrompt) {
      return new Response(JSON.stringify({ error: "No system prompt provided" }), { status: 400 });
    }

    const groq = new Groq({ apiKey });
    const system = systemPrompt.replace("{transcript}", transcript || "(No transcript yet)");

    const stream = await groq.chat.completions.create({
      model: model || GROQ_CHAT_MODEL,
      messages: [{ role: "system", content: system }, ...messages],
      temperature: 0.5,
      max_tokens: 1024,
      stream: true,
    });

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta?.content;
            if (delta) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta })}\n\n`));
            }
          }
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch (e) {
          const msg = parseGroqError(e);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: msg })}\n\n`));
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err: unknown) {
    const message = parseGroqError(err);
    const status = groqErrorStatus(err);
    console.error("[chat]", message);
    return new Response(JSON.stringify({ error: message }), { status });
  }
}
