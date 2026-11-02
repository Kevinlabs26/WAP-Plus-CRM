import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/i18n";
import { getTranslationContextKey, translateDraftText } from "@/lib/translateDraft";
import type { AppSettings } from "@/store/appStore";

type Props = {
  text: string;
  contextKey: string;
  settings: AppSettings;
  language: string;
  onInsert: (mode: "replace" | "append") => void;
};

export function AiSuggestionCard({ text, contextKey, settings, language, onInsert }: Props) {
  const { t } = useI18n();
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ key: string; text: string; error: string } | null>(null);
  const translations = useRef(new Map<string, { key: string; text: string; error: string }>());
  const key = JSON.stringify([contextKey, language, getTranslationContextKey(text, language, settings, { googleFirst: true })]);
  const translation = translations.current.get(key) || (result?.key === key ? result : null);

  useEffect(() => {
    if (!language || translations.current.has(key)) return;
    let active = true;
    const timer = window.setTimeout(() => {
      void translateDraftText(text, language, settings, { googleFirst: true }).then(value => {
        if (!active) return;
        const valid = !value.fallback && !value.error && value.text.trim() && value.targetLang === language;
        const next = { key, text: valid ? value.text : "", error: valid ? "" : value.error || t("crmPanel.translationFailed") };
        if (valid) {
          translations.current.set(key, next);
          while (translations.current.size > 16) translations.current.delete(translations.current.keys().next().value!);
        }
        setResult(next);
      }).catch(error => {
        if (active) setResult({ key, text: "", error: error instanceof Error ? error.message : t("crmPanel.translationFailed") });
      });
    }, 120);
    return () => { active = false; window.clearTimeout(timer); };
    // The key includes translation configuration; unrelated setting changes must not restart a request.
  }, [key, retry]);

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-2.5 transition-colors hover:border-brand/30 hover:bg-zinc-900">
      <p className="line-clamp-3 whitespace-pre-wrap text-[11px] leading-4 text-zinc-300" title={translation?.text || text} dir="auto">
        {translation?.text || text}
      </p>
      {language && !translation && <p role="status" className="mt-1 text-[10px] text-zinc-500">{t("translation.busy")}</p>}
      {translation?.error && <div role="alert" className="mt-1 text-[10px] text-amber-500">
        {translation.error}
        <button type="button" className="ml-2 underline" onClick={() => { setResult(null); setRetry(value => value + 1); }}>{t("common.retry")}</button>
      </div>}
      <div className="mt-2 flex items-center gap-1.5">
        <button type="button" className="rounded-md bg-brand/15 px-2 py-1 text-[10px] font-medium text-brand hover:bg-brand/25"
          title={t("crmPanel.readLanguageHint")} onClick={() => onInsert("replace")}>
          {t(language ? "crmPanel.fillOriginal" : "crmPanel.fillInput")}
        </button>
        <button type="button" className="rounded-md px-2 py-1 text-[10px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          title={t("crmPanel.readLanguageHint")} onClick={() => onInsert("append")}>
          {t(language ? "crmPanel.appendOriginal" : "crmPanel.append")}
        </button>
      </div>
    </div>
  );
}
