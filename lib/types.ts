export type SuggestionType =
  | "QUESTION"
  | "TALKING_POINT"
  | "ANSWER"
  | "FACT_CHECK"
  | "CLARIFICATION";

export interface Suggestion {
  id: string;
  type: SuggestionType;
  preview: string;
  detailPrompt: string;
  timestamp: number;
}

export interface SuggestionBatch {
  id: string;
  suggestions: Suggestion[];
  timestamp: number;
  transcriptLength: number; // how many chars of transcript at time of generation
}

export interface TranscriptChunk {
  id: string;
  text: string;
  timestamp: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  fromSuggestion?: string; // suggestion preview if originated from a card click
}

export interface AppSettings {
  groqApiKey: string;
  transcriptionModel: string;
  suggestionsModel: string;
  chatModel: string;
  suggestionsSystemPrompt: string;
  detailedAnswerPrompt: string;
  chatSystemPrompt: string;
  suggestionsContextWords: number;
  detailedAnswerContextWords: number;
  autoRefreshInterval: number;
}

export interface SessionExport {
  exportedAt: string;
  transcript: { text: string; timestamp: string }[];
  suggestionBatches: {
    timestamp: string;
    suggestions: { type: string; preview: string }[];
  }[];
  chat: { role: string; content: string; timestamp: string; fromSuggestion?: string }[];
}
