import zhCN from "./locales/zh-CN.ts";
import en from "./locales/en.ts";
import fr from "./locales/fr.ts";

export const LOCALES = {
  "zh-CN": { label: "简体中文", messages: zhCN },
  en: { label: "English", messages: en },
  fr: { label: "Français", messages: fr },
} as const;

export type Locale = keyof typeof LOCALES;
export type TranslationKey = keyof typeof zhCN;

const DEFAULT_LOCALE: Locale = "zh-CN";

export function normalizeLocale(value: unknown): Locale {
  return typeof value === "string" && value in LOCALES
    ? (value as Locale)
    : DEFAULT_LOCALE;
}

export function translate(
  locale: Locale,
  key: TranslationKey,
  params: Record<string, string | number> = {}
): string {
  const current = LOCALES[locale].messages as Record<string, string>;
  const fallback = LOCALES[DEFAULT_LOCALE].messages as Record<string, string>;
  let text = current[key] ?? fallback[key] ?? String(key);
  for (const [name, value] of Object.entries(params)) {
    text = text.replaceAll(`{${name}}`, String(value));
  }
  return text;
}

export function getLocaleOptions() {
  return Object.entries(LOCALES).map(([code, value]) => ({
    code: code as Locale,
    label: value.label,
  }));
}
