import { Languages, Loader2, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  TRANSLATE_LANGS,
  langShortLabel,
} from "@/lib/translateDraft";
import { useI18n } from "@/i18n";

type Props = {
  /** 显示条件由父组件外推（有草稿/翻译原文且非录音/非编辑） */
  visible: boolean;
  hasDraft: boolean;
  translateOriginal: string | null;
  translating: boolean;
  translateLang: string;
  /** 该语言是否由系统自动检测（无客户显式选择）：显示小提示，点选即锁定到客户） */
  detected?: boolean;
  onTranslateLangChange: (lang: string) => void;
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
  detected,
  onTranslateLangChange,
  onTranslate,
  onRestore,
  recording,
  recordSec,
}: Props) {
  const { t } = useI18n();
  if (!visible) return null;

  return (
    <div className="order-first flex flex-wrap items-center gap-2 border-b border-zinc-800/90 bg-zinc-950/40 px-2.5 py-1.5">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        <select
          value={translateLang}
          disabled={translating}
          onChange={(e) => onTranslateLangChange(e.target.value)}
          className="h-7 rounded-lg border border-zinc-800 bg-zinc-900 px-1.5 text-[11px] text-zinc-300 outline-none"
          title={
            detected
              ? `自动检测：${langShortLabel(translateLang)} · 点选可锁定到当前客户`
              : t("tooltip.outputLanguage")
          }
        >
          {TRANSLATE_LANGS.map((l) => (
            <option key={l.code} value={l.code}>
              {l.native} · {l.label}
            </option>
          ))}
        </select>
        {detected && (
        <span className="text-2xs text-amber-300/80" title={t("tooltip.translationHint")}>
            自动
          </span>
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
            ? "翻译中…"
            : `译成 ${langShortLabel(translateLang)}`}
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
            还原
          </button>
        )}
      </div>
      {recording ? (
        <span className="text-2xs tabular-nums text-rose-300/90">
          {recordSec}s
        </span>
      ) : (
        <span className="shrink-0 text-2xs text-zinc-600">
          ⌘⇧T 翻译 · Enter 发送
        </span>
      )}
    </div>
  );
}
