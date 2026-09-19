export const VOICE_INPUT_LANGUAGES = [
  { value: "", short: "AUTO", label: "自动 / 系统" },
  { value: "fr", short: "FR", label: "Français" },
  { value: "en", short: "EN", label: "English" },
  { value: "zh", short: "中文", label: "中文" },
  { value: "es", short: "ES", label: "Español" },
  { value: "de", short: "DE", label: "Deutsch" },
  { value: "pt", short: "PT", label: "Português" },
  { value: "ru", short: "RU", label: "Русский" },
  { value: "ar", short: "AR", label: "العربية" },
  { value: "ja", short: "JA", label: "日本語" },
  { value: "ko", short: "KO", label: "한국어" },
] as const;

const LANGUAGE_TAGS: Record<string, string> = {
  zh: "zh-CN",
  en: "en-US",
  fr: "fr-FR",
  es: "es-ES",
  de: "de-DE",
  pt: "pt-BR",
  ru: "ru-RU",
  ar: "ar-SA",
  ja: "ja-JP",
  ko: "ko-KR",
};

export function normalizeVoiceInputLanguage(value: unknown): string {
  const code = String(value || "").trim().toLowerCase();
  return code in LANGUAGE_TAGS ? code : "";
}

export function resolveVoiceInputLanguageTag(
  value: unknown,
  systemLanguage = "en-US"
): string {
  const code = normalizeVoiceInputLanguage(value);
  return LANGUAGE_TAGS[code] || systemLanguage || "en-US";
}
