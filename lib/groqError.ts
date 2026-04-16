/**
 * Parses Groq API errors into user-friendly messages.
 * Extracts retry-after time from rate limit errors.
 */
export function parseGroqError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);

  // Context length exceeded
  if (raw.includes("context_length_exceeded") || raw.includes("maximum context length")) {
    return "Transcript too long for the model context window. Reduce the context window size in Settings → Context & Timing.";
  }

  // Rate limit — extract the retry time if present
  if (raw.includes("rate_limit_exceeded") || raw.includes("Rate limit")) {
    const retryMatch = raw.match(/try again in ([^.]+)/i);
    const retryIn = retryMatch ? ` Try again in ${retryMatch[1].trim()}.` : "";
    const tpdMatch = raw.match(/Limit (\d+), Used (\d+)/);
    if (tpdMatch) {
      return `Rate limit reached (${Number(tpdMatch[2]).toLocaleString()}/${Number(tpdMatch[1]).toLocaleString()} daily tokens used).${retryIn} Upgrade at console.groq.com/settings/billing for unlimited access.`;
    }
    return `Rate limit reached.${retryIn}`;
  }

  // Invalid API key
  if (raw.includes("401") || raw.includes("invalid_api_key") || raw.includes("Incorrect API key")) {
    return "Invalid Groq API key. Check Settings and paste a valid key from console.groq.com.";
  }

  // Model not found
  if (raw.includes("model_not_found") || raw.includes("does not exist")) {
    return "Model not found. Open Settings → Models → Reset models to defaults.";
  }

  // Generic passthrough — strip internal JSON noise
  if (raw.length > 200) return raw.slice(0, 200) + "…";
  return raw;
}
