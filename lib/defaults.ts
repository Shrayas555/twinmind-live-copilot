import {
  DEFAULT_SUGGESTIONS_PROMPT,
  DEFAULT_DETAILED_ANSWER_PROMPT,
  DEFAULT_CHAT_PROMPT,
} from "./prompts";
import type { AppSettings } from "./types";

// GPT-OSS 120B on Groq — update this if Groq changes the model ID
export const GROQ_SUGGESTIONS_MODEL = "meta-llama/llama-4-maverick-17b-128e-instruct";
export const GROQ_CHAT_MODEL = "meta-llama/llama-4-maverick-17b-128e-instruct";
export const GROQ_TRANSCRIPTION_MODEL = "whisper-large-v3";

export const DEFAULT_SETTINGS: AppSettings = {
  groqApiKey: "",
  transcriptionModel: GROQ_TRANSCRIPTION_MODEL,
  suggestionsModel: GROQ_SUGGESTIONS_MODEL,
  chatModel: GROQ_CHAT_MODEL,
  suggestionsSystemPrompt: DEFAULT_SUGGESTIONS_PROMPT,
  detailedAnswerPrompt: DEFAULT_DETAILED_ANSWER_PROMPT,
  chatSystemPrompt: DEFAULT_CHAT_PROMPT,
  // Last ~500 words of transcript for suggestions (recency matters more than full context)
  suggestionsContextWords: 500,
  // Full transcript for detailed answers (the more context, the better the answer)
  detailedAnswerContextWords: 3000,
  // Auto-refresh every 30 seconds
  autoRefreshInterval: 30,
};

export const SETTINGS_STORAGE_KEY = "twinmind_settings";

/** Returns the last N words from transcript text */
export function getContextWindow(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/);
  if (words.length <= maxWords) return text;
  return words.slice(-maxWords).join(" ");
}

/** Formats a timestamp as HH:MM:SS */
export function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", { hour12: false });
}

/** Generates a stable short ID */
export function genId(): string {
  return Math.random().toString(36).slice(2, 9);
}
