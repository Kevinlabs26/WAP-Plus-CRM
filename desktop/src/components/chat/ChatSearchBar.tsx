import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { useI18n } from "@/i18n";

type Props = {
  query: string;
  matchCount: number;
  activeIndex: number;
  onChange: (value: string) => void;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
};

export function ChatSearchBar({
  query,
  matchCount,
  activeIndex,
  onChange,
  onPrevious,
  onNext,
  onClose,
}: Props) {
  const { t } = useI18n();
  const disabled = matchCount === 0;
  return (
    <div className="flex items-center gap-2 border-b border-zinc-800/90 bg-zinc-950/70 px-4 py-2">
      <Search className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
      <input
        autoFocus
        value={query}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
          if (event.key === "Enter") {
            event.preventDefault();
            event.shiftKey ? onPrevious() : onNext();
          }
        }}
        placeholder={t("chat.searchCurrent")}
        className="h-7 min-w-0 flex-1 bg-transparent text-[12px] text-zinc-100 outline-none placeholder:text-zinc-600"
      />
      <span className="shrink-0 text-2xs tabular-nums text-zinc-500">
        {query.trim() && matchCount ? `${activeIndex + 1}/${matchCount}` : "0/0"}
      </span>
      <button type="button" disabled={disabled} onClick={onPrevious} className="rounded p-1 text-zinc-400 hover:bg-zinc-800 disabled:opacity-30" title={t("tooltip.previousMatch")}>
        <ChevronUp className="h-3.5 w-3.5" />
      </button>
      <button type="button" disabled={disabled} onClick={onNext} className="rounded p-1 text-zinc-400 hover:bg-zinc-800 disabled:opacity-30" title={t("tooltip.nextMatch")}>
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      <button type="button" onClick={onClose} className="rounded p-1 text-zinc-400 hover:bg-zinc-800" title={t("tooltip.close")}>
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
