"use client";

import { useEffect, useState } from "react";

interface Props {
  message: string;
  onDismiss: () => void;
}

type ErrorKind = "rate_limit" | "auth" | "model" | "generic";

interface ParsedError {
  kind: ErrorKind;
  headline: string;
  detail: string;
  retrySeconds: number | null; // for rate_limit countdown
  action?: { label: string; href: string };
}

function parseMessage(message: string): ParsedError {
  // Rate limit
  if (message.toLowerCase().includes("rate limit")) {
    // Extract "Xm Ys" or "Xm" retry time
    const retryMatch = message.match(/try again in ([\d]+m[\d.]+s|[\d]+m|[\d.]+s)/i);
    let retrySeconds: number | null = null;
    if (retryMatch) {
      const t = retryMatch[1];
      const m = t.match(/([\d]+)m/);
      const s = t.match(/([\d.]+)s/);
      retrySeconds = (m ? parseInt(m[1]) * 60 : 0) + (s ? parseFloat(s[1]) : 0);
    }

    // Extract token counts
    const tokenMatch = message.match(/\(([\d,]+)\/([\d,]+) daily tokens/);
    const detail = tokenMatch
      ? `${tokenMatch[1]} of ${tokenMatch[2]} daily tokens used.`
      : "Daily token limit reached.";

    return {
      kind: "rate_limit",
      headline: "Rate limit reached",
      detail,
      retrySeconds: retrySeconds ? Math.ceil(retrySeconds) : null,
      action: { label: "Upgrade on Groq", href: "https://console.groq.com/settings/billing" },
    };
  }

  // Auth / invalid key
  if (message.toLowerCase().includes("invalid") && message.toLowerCase().includes("key")) {
    return {
      kind: "auth",
      headline: "Invalid API key",
      detail: "Open Settings and paste a valid key from console.groq.com.",
      retrySeconds: null,
      action: { label: "Open console.groq.com", href: "https://console.groq.com" },
    };
  }

  // Model not found
  if (message.toLowerCase().includes("model not found")) {
    return {
      kind: "model",
      headline: "Model not found",
      detail: "Open Settings → Models → Reset models to defaults.",
      retrySeconds: null,
    };
  }

  // Generic
  return {
    kind: "generic",
    headline: "Error",
    detail: message,
    retrySeconds: null,
  };
}

const KIND_STYLES: Record<ErrorKind, { bar: string; icon: string; text: string; sub: string; btn: string }> = {
  rate_limit: {
    bar: "bg-amber-950/70 border-amber-700/50",
    icon: "text-amber-400",
    text: "text-amber-200",
    sub: "text-amber-400/80",
    btn: "bg-amber-800/60 hover:bg-amber-700/60 text-amber-200",
  },
  auth: {
    bar: "bg-red-950/70 border-red-800/50",
    icon: "text-red-400",
    text: "text-red-200",
    sub: "text-red-400/80",
    btn: "bg-red-800/60 hover:bg-red-700/60 text-red-200",
  },
  model: {
    bar: "bg-orange-950/70 border-orange-800/50",
    icon: "text-orange-400",
    text: "text-orange-200",
    sub: "text-orange-400/80",
    btn: "bg-orange-800/60 hover:bg-orange-700/60 text-orange-200",
  },
  generic: {
    bar: "bg-red-950/60 border-red-800/50",
    icon: "text-red-400",
    text: "text-red-200",
    sub: "text-red-400/70",
    btn: "bg-red-800/60 hover:bg-red-700/60 text-red-200",
  },
};

function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export default function ErrorBanner({ message, onDismiss }: Props) {
  const parsed = parseMessage(message);
  const styles = KIND_STYLES[parsed.kind];

  // Live countdown for rate limit errors
  const [countdown, setCountdown] = useState<number | null>(parsed.retrySeconds);

  useEffect(() => {
    setCountdown(parsed.retrySeconds);
  }, [parsed.retrySeconds]);

  useEffect(() => {
    if (countdown === null || countdown <= 0) return;
    const id = setInterval(() => {
      setCountdown((c) => {
        if (c === null || c <= 1) {
          clearInterval(id);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [countdown]);

  return (
    <div className={`flex items-start justify-between px-4 py-2.5 border-b ${styles.bar} shrink-0`}>
      <div className="flex items-start gap-2.5 min-w-0">
        {/* Icon */}
        <svg className={`w-4 h-4 mt-0.5 shrink-0 ${styles.icon}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          {parsed.kind === "rate_limit" ? (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          )}
        </svg>

        {/* Text */}
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-xs font-semibold ${styles.text}`}>{parsed.headline}</span>
            {/* Live countdown badge */}
            {parsed.kind === "rate_limit" && countdown !== null && (
              <span className={`text-[11px] font-mono px-1.5 py-0.5 rounded bg-amber-900/60 ${styles.sub}`}>
                {countdown > 0 ? `resets in ${formatCountdown(countdown)}` : "limit reset — try again"}
              </span>
            )}
          </div>
          <p className={`text-[11px] mt-0.5 ${styles.sub}`}>{parsed.detail}</p>
        </div>

        {/* Action link */}
        {parsed.action && (
          <a
            href={parsed.action.href}
            target="_blank"
            rel="noopener noreferrer"
            className={`shrink-0 text-[11px] px-2 py-1 rounded ml-1 transition-colors ${styles.btn}`}
          >
            {parsed.action.label} →
          </a>
        )}
      </div>

      {/* Dismiss */}
      <button
        onClick={onDismiss}
        className={`ml-3 shrink-0 ${styles.icon} hover:opacity-70 transition-opacity text-lg leading-none`}
      >
        ✕
      </button>
    </div>
  );
}
