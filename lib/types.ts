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
  content: string;              // displayed in the UI (short preview for suggestion clicks)
  apiContent?: string;          // full content sent to the API (expanded detailPrompt for suggestion clicks)
  timestamp: number;
  fromSuggestionType?: SuggestionType; // type badge to show on suggestion-click messages
}

export interface AppSettings {
  groqApiKey: string;
  transcriptionModel: string;
  suggestionsModel: string;
  chatModel: string;
  suggestionsPrompt: string;
  detailedAnswerPrompt: string;
  chatSystemPrompt: string;
  suggestionsContextWords: number;
  detailedAnswerContextWords: number;
  autoRefreshInterval: number;
}

export type LogType = "transcribe" | "suggestions" | "chat";
export type LogStatus = "success" | "error";

export interface LogEntry {
  id: string;
  timestamp: number;
  type: LogType;
  status: LogStatus;
  durationMs: number;
  detail: string;
}

export interface SessionExport {
  exportedAt: string;
  session: {
    durationMs: number;
    suggestionsModel: string;
    chatModel: string;
    transcriptionModel: string;
  };
  transcript: {
    text: string;
    timestamp: string;
  }[];
  suggestionBatches: {
    timestamp: string;
    suggestions: {
      type: string;
      preview: string;
      detailPrompt: string; // the expansion hint — shows suggestion depth
    }[];
  }[];
  chat: {
    role: string;
    displayContent: string;       // what the user saw in the chat UI
    apiContent?: string;          // full prompt sent to the model (for suggestion clicks)
    timestamp: string;
    fromSuggestionType?: string;  // type of suggestion that triggered this message
  }[];
}
