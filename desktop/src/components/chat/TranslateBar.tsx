import { Languages, Loader2, Undo2 } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import {
  TRANSLATE_LANGS,
  langShortLabel,
  type TargetLanguage,
} from "@/lib/translateDraft";
import { useI18n } from "@/i18n";

type Props = {
  compact?: boolean;
  /** 显示条件由父组件外推（有草稿/翻译原文且非录音/非编辑） */
  visible: boolean;
  hasDraft: boolean;
  translateOriginal: string | null;
  translatedDraft?: string | null;
  translating: boolean;
  translateLang: string;
  source: TargetLanguage["source"];
  onTranslateLangChange: (lang: string) => void;
  onRestoreAuto: () => void;
  onTranslate: () => void;
  onTranslatedDraftChange?: (text: string) => void;
  onRestore: () => void;
  /** 可选：把译文回译成原文语言，仅用于发送前检查。 */
  backTranslation?: string | null;
  backTranslating?: boolean;
  onBackTranslate?: () => void;
  recording: boolean;
  recordSec: number;
};

/**
 * 输入区翻译栏：目标语言、翻译、回译检查与还原。
 */
export function TranslateBar({
  compact = false,
  visible,
  hasDraft,
  translateOriginal,
  translatedDraft,
  translating,
  translateLang,
  source,
  onTranslateLangChange,
  onRestoreAuto,
  onTranslate,
  onTranslatedDraftChange,
  onRestore,
  backTranslation = null,
  backTranslating = false,
  onBackTranslate,
  recording,
  recordSec,
}: Props) {
  const { t } = useI18n();
  const translatedDraftRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const textarea = translatedDraftRef.current;
    if (!textarea) return;
    const fitHeight = () => {
      textarea.style.height = "0px";
      textarea.style.height = `${textarea.scrollHeight}px`;
    };
    fitHeight();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fitHeight);
    if (textarea.parentElement) observer?.observe(textarea.parentElement);
    return () => observer?.disconnect();
  }, [translatedDraft, visible]);
  if (!visible) return null;
  const sourceLabels = {
    preferred: "translation.sourcePreferred",
    country: "translation.sourceCountry",
    message: "translation.sourceMessage",
    default: "translation.sourceDefault",
  } as const;
  const sourceLabel = t(sourceLabels[source]);

  return (
    <div className="order-first flex flex-wrap items-center gap-2 border-b border-zinc-800/90 bg-zinc-950/40 px-2.5 py-1.5">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        <select
          value={source === "preferred" ? translateLang : "auto"}
          disabled={translating}
          onChange={(e) => {
            if (translating) return;
            if (e.target.value === "auto") onRestoreAuto();
            else onTranslateLangChange(e.target.value);
          }}
          className={cn("h-7 min-w-0 rounded-lg border border-zinc-800 bg-zinc-900 px-1.5 text-[11px] text-zinc-300 outline-none", compact ? "max-w-32" : "max-w-48")}
          title={`${t("tooltip.outputLanguage")} · ${sourceLabel}`}
          aria-label={t("tooltip.outputLanguage")}
        >
          <option value="auto">{t("translation.auto")}{source !== "preferred" && ` · ${langShortLabel(translateLang)}`}</option>
          {TRANSLATE_LANGS.map((l) => (
            <option key={l.code} value={l.code}>
              {compact ? l.native : `${l.native} · ${l.label}`}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!hasDraft || translating}
          onClick={onTranslate}
          className={cn(
            "inline-flex h-7 items-center gap-1 rounded-lg px-2.5 text-[11px] font-medium transition",
            translating
              ? "text-zinc-500"
              : "bg-brand/10 text-brand hover:bg-brand/15"
          )}
          title={`${t("translation.to", { language: langShortLabel(translateLang) })} · Ctrl+Shift+T`}
        >
          {translating ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Languages className="h-3 w-3" />
          )}
          {translating
            ? t("translation.busy")
            : t("tooltip.translate")}
        </button>
        {translatedDraft != null && onBackTranslate && !backTranslation && !backTranslating && (
          <button
            type="button"
            disabled={translating}
            onClick={onBackTranslate}
            className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
            title={t("translation.showBack")}
          >
            <Languages className="h-3 w-3" />
            {t("translation.showBack")}
          </button>
        )}
        {(translatedDraft != null || translateOriginal != null) && (
          <button
            type="button"
            disabled={translating}
            onClick={onRestore}
            className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            title={t("translation.clearResult")}
          >
            <Undo2 className="h-3 w-3" />
            {t("translation.clearResult")}
          </button>
        )}
      </div>
      {translatedDraft != null && (
        <div className="w-full min-w-0 space-y-0.5" aria-live="polite">
          <div className="flex min-w-0 items-start gap-1.5 px-1.5 py-0.5 transition-colors focus-within:rounded-md focus-within:bg-brand/5">
            <span className="shrink-0 text-[12px] leading-5 text-brand">{t("translation.resultLabel")}:</span>
            <textarea
              ref={translatedDraftRef}
              value={translatedDraft}
              onChange={(e) => onTranslatedDraftChange?.(e.target.value)}
              rows={1}
              aria-label={t("translation.resultLabel")}
              className="block min-h-5 min-w-0 flex-1 resize-none overflow-hidden bg-transparent p-0 text-[12px] leading-5 text-zinc-200 outline-none placeholder:text-zinc-500"
            />
          </div>
          {(backTranslation != null || backTranslating) && (
            <div className="flex min-w-0 items-start gap-1.5 px-1.5 text-[11px] leading-5 text-zinc-500">
              <span className="shrink-0">{t("translation.backLabel")}:</span>
              <span className="min-w-0 whitespace-pre-wrap break-words">
                {backTranslating
                  ? t("translation.backBusy")
                  : backTranslation || t("translation.backUnavailable")}
              </span>
            </div>
          )}
        </div>
      )}
      {recording ? (
        <span className="text-2xs tabular-nums text-rose-300/90">
          {recordSec}s
        </span>
      ) : null}
    </div>
  );
}
