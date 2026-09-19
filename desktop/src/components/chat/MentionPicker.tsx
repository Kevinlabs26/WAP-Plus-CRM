import { avatarInitials, cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import type { MentionCandidate } from "@/lib/groupMention";

type Props = {
  open: boolean;
  items: MentionCandidate[];
  activeIndex: number;
  onHover: (index: number) => void;
  onPick: (item: MentionCandidate) => void;
};

export function MentionPicker({
  open,
  items,
  activeIndex,
  onHover,
  onPick,
}: Props) {
  const { t } = useI18n();
  if (!open || !items.length) return null;
  return (
    <div
      className="absolute bottom-full left-0 z-30 mb-1 max-h-56 w-72 overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl"
      role="listbox"
      aria-label={t("tooltip.mentionMember")}
    >
      {items.map((it, i) => (
        <button
          key={it.everyone ? "__everyone__" : it.jid}
          type="button"
          role="option"
          aria-selected={i === activeIndex}
          className={cn(
            "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px]",
            i === activeIndex
              ? "bg-brand/15 text-brand"
              : "text-zinc-200 hover:bg-zinc-800"
          )}
          onMouseEnter={() => onHover(i)}
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(it);
          }}
        >
          <span
            className={cn(
              "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-2xs font-semibold",
              it.everyone
                ? "bg-violet-500/20 text-violet-200"
                : "bg-zinc-800 text-zinc-300"
            )}
          >
            {it.everyone
              ? "@"
              : avatarInitials(it.label || it.phoneE164 || it.jid || "?", "?")}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">
              {it.everyone ? t("mention.everyone") : it.label}
            </span>
            {!it.everyone && (
              <span className="block truncate font-mono text-2xs text-zinc-500">
                {it.phoneE164 || it.jid}
              </span>
            )}
          </span>
        </button>
      ))}
    </div>
  );
}
