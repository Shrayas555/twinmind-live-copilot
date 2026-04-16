"use client";

import { useState } from "react";
import type { AppSettings } from "@/lib/types";
import { DEFAULT_SETTINGS } from "@/lib/defaults";

interface Props {
  settings: AppSettings;
  onSave: (patch: Partial<AppSettings>) => void;
  onClose: () => void;
}

type Tab = "api" | "models" | "prompts" | "context";

const TAB_LABELS: { id: Tab; label: string }[] = [
  { id: "api", label: "API Key" },
  { id: "models", label: "Models" },
  { id: "prompts", label: "Prompts" },
  { id: "context", label: "Context & Timing" },
];

export default function SettingsModal({ settings, onSave, onClose }: Props) {
  const [local, setLocal] = useState<AppSettings>({ ...settings });
  const [tab, setTab] = useState<Tab>("api");
  const [showKey, setShowKey] = useState(false);

  const set = (key: keyof AppSettings, value: string | number) => {
    setLocal((prev) => ({ ...prev, [key]: value }));
  };

  const save = () => {
    onSave(local);
    onClose();
  };

  const resetPrompts = () => {
    setLocal((prev) => ({
      ...prev,
      suggestionsSystemPrompt: DEFAULT_SETTINGS.suggestionsSystemPrompt,
      detailedAnswerPrompt: DEFAULT_SETTINGS.detailedAnswerPrompt,
      chatSystemPrompt: DEFAULT_SETTINGS.chatSystemPrompt,
    }));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-2xl mx-4 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl flex flex-col max-h-[90vh]">
        {/* Modal header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <h2 className="text-base font-semibold text-white">Settings</h2>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-white transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-zinc-800 px-6">
          {TAB_LABELS.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`
                py-3 px-1 mr-6 text-sm border-b-2 transition-colors
                ${tab === id
                  ? "border-white text-white"
                  : "border-transparent text-zinc-500 hover:text-zinc-300"
                }
              `}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {tab === "api" && (
            <>
              <Field label="Groq API Key" hint="Never stored server-side. Saved in your browser's localStorage.">
                <div className="flex gap-2">
                  <input
                    type={showKey ? "text" : "password"}
                    value={local.groqApiKey}
                    onChange={(e) => set("groqApiKey", e.target.value)}
                    placeholder="gsk_..."
                    className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 font-mono"
                  />
                  <button
                    onClick={() => setShowKey(!showKey)}
                    className="px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-xs text-zinc-400 hover:text-white transition-colors"
                  >
                    {showKey ? "Hide" : "Show"}
                  </button>
                </div>
              </Field>
              <div className="text-xs text-zinc-500 bg-zinc-800/50 rounded-lg p-3 space-y-1">
                <p>Get a free API key at <span className="text-zinc-300 font-mono">console.groq.com</span></p>
                <p>Your key is used client-side and never sent to our servers.</p>
              </div>
            </>
          )}

          {tab === "models" && (
            <>
              <div className="flex justify-end">
                <button
                  onClick={() =>
                    setLocal((prev) => ({
                      ...prev,
                      transcriptionModel: DEFAULT_SETTINGS.transcriptionModel,
                      suggestionsModel: DEFAULT_SETTINGS.suggestionsModel,
                      chatModel: DEFAULT_SETTINGS.chatModel,
                    }))
                  }
                  className="text-xs text-zinc-500 hover:text-zinc-300 underline underline-offset-2 transition-colors"
                >
                  Reset models to defaults
                </button>
              </div>
              <Field label="Transcription Model" hint="Groq Whisper model for audio-to-text.">
                <TextInput value={local.transcriptionModel} onChange={(v) => set("transcriptionModel", v)} mono />
              </Field>
              <Field label="Suggestions Model" hint="Model used to generate live suggestions. Check console.groq.com/docs/models for IDs available on your account.">
                <TextInput value={local.suggestionsModel} onChange={(v) => set("suggestionsModel", v)} mono />
              </Field>
              <Field label="Chat Model" hint="Model used for detailed answers and chat.">
                <TextInput value={local.chatModel} onChange={(v) => set("chatModel", v)} mono />
              </Field>
              <div className="text-xs text-zinc-500 bg-zinc-800/50 rounded-lg p-3 space-y-1">
                <p>Required: <span className="text-zinc-300 font-mono">openai/gpt-oss-120b</span></p>
                <p>Fallback if your tier lacks access: <span className="text-zinc-400 font-mono">llama-3.3-70b-versatile</span></p>
              </div>
            </>
          )}

          {tab === "prompts" && (
            <>
              <div className="flex justify-end">
                <button
                  onClick={resetPrompts}
                  className="text-xs text-zinc-500 hover:text-zinc-300 underline underline-offset-2 transition-colors"
                >
                  Reset all prompts to defaults
                </button>
              </div>
              <Field
                label="Live Suggestions Prompt"
                hint="System prompt for generating the 3 suggestion cards. Use {transcript} as the placeholder."
              >
                <PromptArea value={local.suggestionsSystemPrompt} onChange={(v) => set("suggestionsSystemPrompt", v)} />
              </Field>
              <Field
                label="Detailed Answer Prompt"
                hint="Prompt used when a suggestion is clicked. Variables: {transcript}, {type}, {preview}, {detailPrompt}."
              >
                <PromptArea value={local.detailedAnswerPrompt} onChange={(v) => set("detailedAnswerPrompt", v)} />
              </Field>
              <Field
                label="Chat System Prompt"
                hint="System prompt for the chat panel. Use {transcript} as the placeholder."
              >
                <PromptArea value={local.chatSystemPrompt} onChange={(v) => set("chatSystemPrompt", v)} />
              </Field>
            </>
          )}

          {tab === "context" && (
            <>
              <Field
                label="Suggestions Context Window (words)"
                hint="Number of recent transcript words sent when generating suggestions. Larger = more context, slower. Default: 600."
              >
                <NumberInput value={local.suggestionsContextWords} onChange={(v) => set("suggestionsContextWords", v)} min={100} max={2000} />
              </Field>
              <Field
                label="Detailed Answer Context Window (words)"
                hint="Words of transcript sent when a suggestion is clicked. Default: 3000 (effectively full transcript)."
              >
                <NumberInput value={local.detailedAnswerContextWords} onChange={(v) => set("detailedAnswerContextWords", v)} min={100} max={10000} />
              </Field>
              <Field
                label="Auto-Refresh Interval (seconds)"
                hint="How often suggestions auto-refresh while recording. Default: 30s."
              >
                <NumberInput value={local.autoRefreshInterval} onChange={(v) => set("autoRefreshInterval", v)} min={10} max={300} />
              </Field>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-zinc-800">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm text-zinc-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={save}
            className="px-4 py-2 rounded-lg bg-white text-black text-sm font-medium hover:bg-zinc-200 transition-colors"
          >
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-zinc-300">{label}</label>
      <p className="text-xs text-zinc-500">{hint}</p>
      {children}
    </div>
  );
}

function TextInput({
  value,
  onChange,
  mono,
}: {
  value: string;
  onChange: (v: string) => void;
  mono?: boolean;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500 ${mono ? "font-mono" : ""}`}
    />
  );
}

function NumberInput({
  value,
  onChange,
  min,
  max,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500 font-mono"
    />
  );
}

function PromptArea({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={8}
      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-300 font-mono leading-relaxed focus:outline-none focus:border-zinc-500 resize-y"
    />
  );
}
