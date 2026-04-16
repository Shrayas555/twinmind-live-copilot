"use client";

import { useState, useEffect, useCallback } from "react";
import { DEFAULT_SETTINGS, SETTINGS_STORAGE_KEY } from "@/lib/defaults";
import type { AppSettings } from "@/lib/types";

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (stored) {
        // Merge stored with defaults so new fields added later get their defaults
        setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(stored) });
      }
    } catch {
      // ignore
    }
    setLoaded(true);
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

  const resetPrompts = useCallback(() => {
    updateSettings({
      suggestionsSystemPrompt: DEFAULT_SETTINGS.suggestionsSystemPrompt,
      detailedAnswerPrompt: DEFAULT_SETTINGS.detailedAnswerPrompt,
      chatSystemPrompt: DEFAULT_SETTINGS.chatSystemPrompt,
    });
  }, [updateSettings]);

  return { settings, updateSettings, resetPrompts, loaded };
}
