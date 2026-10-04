import { Languages, Loader2, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  TRANSLATE_LANGS,
  langShortLabel,
  type TargetLanguage,
} from "@/lib/translateDraft";
import { useI18n } from "@/i18n";

type Props = {
  /** 显示条件由父组件外推（有草稿/翻译原文且非录音/非编辑） */
  visible: boolean;
  hasDraft: boolean;
  translateOriginal: string | null;
  translating: boolean;
  translateLang: string;
  source: TargetLanguage["source"];
  onTranslateLangChange: (lang: string) => void;
  onRestoreAuto: () => void;
  onTranslate: () => void;
  onRestore: () => void;
  recording: boolean;
  recordSec: number;
};

/**
 * 输入区底部横条：翻译语言选择 / 翻译按钮 / 还原原文 / 快捷键提示。
 */
export function TranslateBar({
  visible,
  hasDraft,
  translateOriginal,
  translating,
  translateLang,
  source,
  onTranslateLangChange,
  onRestoreAuto,
  onTranslate,
  onRestore,
  recording,
  recordSec,
}: Props) {
  const { t } = useI18n();
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
          value={translateLang}
          disabled={translating}
          onChange={(e) => onTranslateLangChange(e.target.value)}
          className="h-7 rounded-lg border border-zinc-800 bg-zinc-900 px-1.5 text-[11px] text-zinc-300 outline-none"
          title={`${t("tooltip.outputLanguage")} · ${sourceLabel}`}
          aria-label={t("tooltip.outputLanguage")}
        >
          {TRANSLATE_LANGS.map((l) => (
            <option key={l.code} value={l.code}>
              {l.native} · {l.label}
            </option>
          ))}
        </select>
        <span className="text-2xs text-zinc-300">{sourceLabel}</span>
        {source === "preferred" && (
          <button
            type="button"
            disabled={translating}
            onClick={onRestoreAuto}
            className="inline-flex h-7 items-center rounded-lg px-2 text-[11px] text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("translation.restoreAuto")}
          </button>
        )}
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
          title="Ctrl+Shift+T"
        >
          {translating ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Languages className="h-3 w-3" />
          )}
          {translating
            ? t("translation.busy")
            : t("translation.to", { language: langShortLabel(translateLang) })}
        </button>
        {translateOriginal != null && (
          <button
            type="button"
            disabled={translating}
            onClick={onRestore}
            className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            title={t("tooltip.restoreOriginal")}
          >
            <Undo2 className="h-3 w-3" />
            {t("translation.restore")}
          </button>
        )}
      </div>
      {recording ? (
        <span className="text-2xs tabular-nums text-rose-300/90">
          {recordSec}s
        </span>
      ) : (
        <span className="shrink-0 text-2xs text-zinc-600">
          {t("translation.shortcuts")}
        </span>
      )}
    </div>
  );
}
