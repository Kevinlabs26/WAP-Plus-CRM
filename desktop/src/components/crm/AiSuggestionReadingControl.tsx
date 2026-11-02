import { ChevronDown } from "lucide-react";
import { useI18n } from "@/i18n";
import { langShortLabel, TRANSLATE_LANGS } from "@/lib/translateDraft";

type Props = {
  language: string;
  targetLanguage: string;
  onChange: (language: string) => void;
};

export function AiSuggestionReadingControl({ language, targetLanguage, onChange }: Props) {
  const { t } = useI18n();
  const buttonClass = "h-6 rounded px-2 text-[10px] transition-colors";
  return (
    <div role="group" aria-label={t("crmPanel.readLanguage")} title={t("crmPanel.readLanguageHint")}
      className="inline-flex shrink-0 items-center rounded-md bg-zinc-800 p-0.5">
      <button type="button" aria-pressed={!language} onClick={() => onChange("")}
        className={`${buttonClass} ${!language ? "bg-brand/15 font-medium text-brand" : "text-zinc-400 hover:text-zinc-200"}`}>
        {t("tooltip.originalText")}
      </button>
      <button type="button" aria-pressed={!!language} onClick={() => onChange(targetLanguage)}
        className={`${buttonClass} ${language ? "bg-brand/15 font-medium text-brand" : "text-zinc-400 hover:text-zinc-200"}`}>
        {langShortLabel(targetLanguage)}
      </button>
      <div className="relative flex h-6 w-5 items-center justify-center rounded text-zinc-400 focus-within:ring-1 focus-within:ring-brand">
        <ChevronDown className="pointer-events-none h-3 w-3" />
        <select value={targetLanguage} aria-label={t("crmPanel.readLanguage")}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          onChange={event => {
            if (TRANSLATE_LANGS.some(item => item.code === event.target.value)) onChange(event.target.value);
          }}>
          {TRANSLATE_LANGS.map(item => <option key={item.code} value={item.code}>{item.label}</option>)}
        </select>
      </div>
    </div>
  );
}
