import type { SettingsShape } from "@/store/settingsDefaults";
import { GEMINI_DEFAULT_MODEL } from "./gemini.ts";

export type TranscriptionProvider = "none" | "openai" | "groq" | "gemini" | "custom";
export const TRANSCRIPTION_DEFAULTS = {
  none: { baseUrl: "", model: "" },
  openai: { baseUrl: "https://api.openai.com/v1", model: "whisper-1" },
  groq: { baseUrl: "https://api.groq.com/openai/v1", model: "whisper-large-v3-turbo" },
  gemini: { baseUrl: "", model: GEMINI_DEFAULT_MODEL },
  custom: { baseUrl: "", model: "" },
} satisfies Record<TranscriptionProvider, { baseUrl: string; model: string }>;

export function resolveTranscriptionConfig(settings: Partial<SettingsShape>) {
  const legacy = settings.transcriptionProvider === undefined;
  const requested = legacy ? settings.aiProvider : settings.transcriptionProvider;
  const provider: TranscriptionProvider = requested && Object.hasOwn(TRANSCRIPTION_DEFAULTS, requested)
    ? requested as TranscriptionProvider : "none";
  const defaults = TRANSCRIPTION_DEFAULTS[provider];
  const apiKey = legacy
    ? provider === "custom" ? settings.customAiKey : provider === "openai" ? settings.openaiKey
      : provider === "groq" ? settings.groqKey : provider === "gemini" ? settings.geminiKey : ""
    : settings.transcriptionApiKey;
  const model = legacy
    ? provider === "custom" ? settings.customWhisperModel : provider === "gemini" ? settings.aiModel : defaults.model
    : settings.transcriptionModel;
  const baseUrl = legacy ? provider === "custom" ? settings.customAiBaseUrl : defaults.baseUrl : settings.transcriptionBaseUrl;
  return { provider, apiKey: String(apiKey || "").trim(), model: String(model || defaults.model).trim(),
    baseUrl: String(baseUrl || defaults.baseUrl).trim().replace(/\/+$/, "") };
}
