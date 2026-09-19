import EmojiPicker, {
  EmojiStyle,
  Theme,
  type EmojiClickData,
} from "emoji-picker-react";
import { X } from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { useI18n } from "@/i18n";

type Props = {
  onPick: (emoji: string) => void;
  onClose: () => void;
};

export function ReactionEmojiPicker({ onPick, onClose }: Props) {
  const theme = useAppStore((s) => s.settings.theme);
  const { t } = useI18n();

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl shadow-black/60">
      <div className="flex h-10 items-center justify-between border-b border-zinc-800 px-3">
        <span className="text-[12px] font-medium text-zinc-200">
          {t("reaction.choose")}
        </span>
        <button
          type="button"
          aria-label={t("tooltip.closePicker")}
          className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
          onClick={onClose}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <EmojiPicker
        theme={theme === "light" ? Theme.LIGHT : Theme.DARK}
        emojiStyle={EmojiStyle.NATIVE}
        width="100%"
        height={320}
        lazyLoadEmojis
        searchPlaceHolder={t("emoji.search")}
        previewConfig={{ showPreview: false }}
        onEmojiClick={(data: EmojiClickData) => onPick(data.emoji)}
      />
    </div>
  );
}
