import {
  DEFAULT_SUGGESTIONS_PROMPT,
  DEFAULT_DETAILED_ANSWER_PROMPT,
  DEFAULT_CHAT_PROMPT,
} from "./prompts";
import type { AppSettings } from "./types";

// Best available open model on Groq. Check console.groq.com/docs/models for your tier.
export const GROQ_SUGGESTIONS_MODEL = "llama-3.3-70b-versatile";
export const GROQ_CHAT_MODEL = "llama-3.3-70b-versatile";
export const GROQ_TRANSCRIPTION_MODEL = "whisper-large-v3";

export const DEFAULT_SETTINGS: AppSettings = {
  groqApiKey: "",
  transcriptionModel: GROQ_TRANSCRIPTION_MODEL,
  suggestionsModel: GROQ_SUGGESTIONS_MODEL,
  chatModel: GROQ_CHAT_MODEL,
  suggestionsSystemPrompt: DEFAULT_SUGGESTIONS_PROMPT,
  detailedAnswerPrompt: DEFAULT_DETAILED_ANSWER_PROMPT,
  chatSystemPrompt: DEFAULT_CHAT_PROMPT,
  // Last ~600 words for suggestions — ~3 minutes of speech, enough for recency without diluting signal
  suggestionsContextWords: 600,
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

/**
 * Two-tier context for suggestions:
 * - Opening scene (first 60 words) sets the topic/type of conversation
 * - Recent window (last N words) is what matters for what to do right now
 * Helps the model understand both "what kind of meeting is this" and "what just happened"
 */
export function getSuggestionsContext(text: string, recentWords: number): string {
  const words = text.trim().split(/\s+/);
  if (words.length <= recentWords) return text;

  const openingWords = 60;
  const opening = words.slice(0, openingWords).join(" ");
  const recent = words.slice(-recentWords).join(" ");

  // Only add the opening scene if there's a meaningful gap (>120 words between them)
  if (words.length > recentWords + openingWords + 120) {
    return `[Meeting opening] ${opening}\n\n[Recent — focus here] ${recent}`;
  }
  return recent;
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
