"use client";

import { useState, useEffect, useCallback, startTransition } from "react";
import { DEFAULT_SETTINGS, SETTINGS_STORAGE_KEY } from "@/lib/defaults";
import type { AppSettings } from "@/lib/types";

// Bump this string whenever default prompts change.
// On mismatch, prompts reset to new defaults while preserving the user's API key.
const PROMPT_VERSION = "v5";
const PROMPT_VERSION_KEY = "twinmind_prompt_version";

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
      const storedVersion = localStorage.getItem(PROMPT_VERSION_KEY);

      if (storedVersion !== PROMPT_VERSION) {
        // Prompts changed — reset to new defaults but preserve the user's API key
        let apiKey = "";
        if (stored) {
          try { apiKey = (JSON.parse(stored) as Partial<AppSettings>).groqApiKey ?? ""; } catch { /* ignore */ }
        }
        const fresh: AppSettings = { ...DEFAULT_SETTINGS, groqApiKey: apiKey };
        startTransition(() => {
          setSettings(fresh);
        });
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(fresh));
        localStorage.setItem(PROMPT_VERSION_KEY, PROMPT_VERSION);
      } else if (stored) {
        // Version matches — merge stored with defaults so new non-prompt fields get defaults
        startTransition(() => {
          setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(stored) });
        });
      }
    } catch {
      // ignore storage errors
    }
    startTransition(() => {
      setLoaded(true);
    });
  }, []);

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore storage errors
      }
      return next;
    });
  }, []);

  return { settings, updateSettings, loaded };
}
