import Groq from "groq-sdk";

/**
 * Parses Groq API errors into user-friendly messages.
 * Uses Groq.APIError status codes + error codes when available — more reliable than string matching.
 */
export function parseGroqError(err: unknown): string {
  // Groq SDK APIError — prefer status codes and error codes over string matching
  if (err instanceof Groq.APIError) {
    const code = (err.error as { code?: string } | null)?.code ?? "";
    return classifyByStatus(err.status, err.message, code);
  }

  // Network / environment errors (no response received)
  const raw = err instanceof Error ? err.message : String(err);
  if (
    raw.toLowerCase().includes("failed to fetch") ||
    raw.includes("NetworkError") ||
    raw.includes("ECONNREFUSED") ||
    raw.includes("ENOTFOUND")
  ) {
    return "Network error — check your connection and try again.";
  }

  // Fallback: string matching for edge cases (wrapped errors, non-SDK throws)
  return classifyByString(raw);
}

/** Returns the HTTP status code to forward to the client for a Groq error. */
export function groqErrorStatus(err: unknown): number {
  if (err instanceof Groq.APIError) {
    // Forward meaningful status codes the client uses to drive UI (rate limit, auth)
    if (err.status === 429 || err.status === 401 || err.status === 404) return err.status;
    return 500;
  }
  return 500;
}

function classifyByStatus(status: number, message: string, code: string): string {
  if (status === 429 || code === "rate_limit_exceeded") {
    const retryMatch = message.match(/try again in ([^.]+)/i);
    const retryIn = retryMatch ? ` Try again in ${retryMatch[1].trim()}.` : "";
    const tpdMatch = message.match(/Limit (\d+), Used (\d+)/);
    if (tpdMatch) {
      return `Rate limit reached (${Number(tpdMatch[2]).toLocaleString()}/${Number(tpdMatch[1]).toLocaleString()} daily tokens used).${retryIn}`;
    }
    return `Rate limit reached.${retryIn}`;
  }

  if (status === 401 || code === "invalid_api_key") {
    return "Invalid Groq API key. Check Settings and paste a valid key from console.groq.com.";
  }

  if (status === 404 || code === "model_not_found") {
    return "Model not found. Open Settings → Models → Reset models to defaults.";
  }

  if (code === "context_length_exceeded") {
    return "Transcript too long for the model context window. Reduce context window in Settings → Context & Timing.";
  }

  if (status === 503 || status === 502) {
    return "Groq service unavailable — try again in a moment.";
  }

  return message.length > 200 ? message.slice(0, 200) + "…" : message;
}

function classifyByString(raw: string): string {
  if (raw.includes("context_length_exceeded") || raw.includes("maximum context length")) {
    return "Transcript too long for the model context window. Reduce context window in Settings → Context & Timing.";
  }
  if (raw.includes("rate_limit_exceeded") || raw.toLowerCase().includes("rate limit")) {
    const retryMatch = raw.match(/try again in ([^.]+)/i);
    const retryIn = retryMatch ? ` Try again in ${retryMatch[1].trim()}.` : "";
    return `Rate limit reached.${retryIn}`;
  }
  if (raw.includes("401") || raw.includes("invalid_api_key") || raw.includes("Incorrect API key")) {
    return "Invalid Groq API key. Check Settings and paste a valid key from console.groq.com.";
  }
  if (raw.includes("model_not_found") || raw.includes("does not exist")) {
    return "Model not found. Open Settings → Models → Reset models to defaults.";
  }
  return raw.length > 200 ? raw.slice(0, 200) + "…" : raw;
}
