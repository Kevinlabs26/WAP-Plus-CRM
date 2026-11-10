import type { AppSettings } from "@/store/types";
import { getOpenAiCompatibleConfig } from "./aiProviders.ts";
import { GEMINI_DEFAULT_MODEL } from "./gemini.ts";
import { isChatModel } from "./modelCapabilities.ts";

export type TranslationProvider = AppSettings["aiProvider"];
export const GROQ_TRANSLATION_MODEL = "openai/gpt-oss-20b";
const PROVIDERS = ["mock", "openai", "groq", "deepseek", "qwen", "zhipu", "openrouter", "gemini", "vertex", "ollama", "custom"];

export function resolveTranslationConfig(settings: Partial<AppSettings>) {
  const legacy = settings.translationProvider === undefined;
  const requested = legacy ? settings.aiProvider ?? "groq" : settings.translationProvider;
  const provider = (PROVIDERS.includes(String(requested)) ? requested : "mock") as TranslationProvider;
  const defaults = getOpenAiCompatibleConfig({ aiProvider: provider });
  const previous = getOpenAiCompatibleConfig(settings);
  const rawModel = String(legacy ? (provider === "custom" ? settings.customAiModel : settings.aiModel || previous?.model) || "" : settings.translationModel || "").trim();
  const model = (isChatModel(rawModel) ? rawModel : "") || (provider === "groq" ? GROQ_TRANSLATION_MODEL
    : provider === "gemini" ? GEMINI_DEFAULT_MODEL : provider === "ollama" ? "llama3.2" : defaults?.model || "");
  const legacyKey = provider === "gemini" ? settings.geminiKey : previous?.apiKey;
  return { provider, model,
    apiKey: String((legacy ? legacyKey : settings.translationApiKey) || "").trim(),
    baseUrl: String((legacy ? provider === "ollama" ? settings.ollamaUrl : previous?.baseUrl : settings.translationBaseUrl) || defaults?.baseUrl || (provider === "ollama" ? "http://127.0.0.1:11434" : "")).trim().replace(/\/+$/, ""),
  };
}

/** Adapt only at the translation boundary; never persist this view over reply settings. */
export function getTranslationSettings(settings: AppSettings): AppSettings {
  const config = resolveTranslationConfig(settings);
  return { ...settings, aiProvider: config.provider, aiModel: config.model,
    openaiKey: config.apiKey, groqKey: config.apiKey, geminiKey: config.apiKey,
    deepseekKey: config.apiKey, qwenKey: config.apiKey, zhipuKey: config.apiKey, openrouterKey: config.apiKey,
    customAiKey: config.apiKey, customAiModel: config.model, customAiBaseUrl: config.baseUrl, ollamaUrl: config.baseUrl };
}

export function translationSettingsPatch(patch: Partial<AppSettings>): Partial<AppSettings> {
  const result: Partial<AppSettings> = {};
  if (patch.aiProvider !== undefined) {
    const defaults = resolveTranslationConfig({ translationProvider: patch.aiProvider });
    Object.assign(result, { translationProvider: defaults.provider, translationBaseUrl: defaults.baseUrl, translationModel: "", translationApiKey: "" });
  }
  for (const key of ["openaiKey", "groqKey", "geminiKey", "deepseekKey", "qwenKey", "zhipuKey", "openrouterKey", "customAiKey"] as const) {
    if (patch[key] !== undefined) result.translationApiKey = patch[key];
  }
  if (patch.aiModel !== undefined) result.translationModel = patch.aiModel;
  if (patch.customAiModel !== undefined) result.translationModel = patch.customAiModel;
  if (patch.customAiBaseUrl !== undefined) result.translationBaseUrl = patch.customAiBaseUrl;
  if (patch.ollamaUrl !== undefined) result.translationBaseUrl = patch.ollamaUrl;
  for(const key of ["vertexProjectId","vertexLocation","vertexCredentialId"] as const)if(patch[key]!==undefined)result[key]=patch[key];
  return result;
}
