import { useCallback } from "react";
import { useAppStore } from "@/store/appStore";
export {
  LOCALES,
  getLocaleOptions,
  normalizeLocale,
  translate,
  type Locale,
  type TranslationKey,
} from "./core";
import { LOCALES, normalizeLocale, translate, type TranslationKey } from "./core";

export function useI18n() {
  const locale = normalizeLocale(useAppStore((state) => state.settings.uiLanguage));
  const t = useCallback(
    (key: TranslationKey, params?: Record<string, string | number>) =>
      translate(locale, key, params),
    [locale]
  );
  return { locale, t, locales: LOCALES };
}

/** Translate from non-React actions (send queues, bridge watchers, etc.). */
export function translateCurrent(
  key: TranslationKey,
  params?: Record<string, string | number>
) {
  const locale = normalizeLocale(useAppStore.getState().settings.uiLanguage);
  return translate(locale, key, params);
}
