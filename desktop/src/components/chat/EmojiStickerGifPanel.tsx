import { useState } from "react";
import EmojiPicker, {
  EmojiStyle,
  Theme,
  type EmojiClickData,
} from "emoji-picker-react";
import { Sticker, X } from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";

type Props = {
  open: boolean;
  isBaileys: boolean;
  /** 点击一个 emoji：父组件把字符追加进草稿并 flush */
  onPickEmoji: (emoji: string) => void;
  /** 容器内"制作贴纸"按钮选中本地图片的入口 */
  onPickStickerFile: () => void;
  /** "选择本地 GIF"入口 */
  onPickGifFile: () => void;
  favoriteStickers: string[];
  recentStickers: string[];
  onSendFavoriteSticker: (dataUrl: string) => void;
  onRemoveFavoriteSticker: (dataUrl: string) => void;
  onSendRecentSticker: (dataUrl: string) => void;
};

/**
 * Emoji / 贴纸 / GIF 三标签面板。pickerTab 自持；
 * 点击贴纸发送后由父组件关闭面板（onSend* 内部处理）。
 */
export function EmojiStickerGifPanel({
  open,
  isBaileys,
  onPickEmoji,
  onPickStickerFile,
  onPickGifFile,
  favoriteStickers,
  recentStickers,
  onSendFavoriteSticker,
  onRemoveFavoriteSticker,
  onSendRecentSticker,
}: Props) {
  const [pickerTab, setPickerTab] = useState<"emoji" | "sticker" | "gif">(
    "emoji"
  );
  const theme = useAppStore((s) => s.settings.theme);
  const { t } = useI18n();
  if (!open) return null;

  return (
    <div className="absolute bottom-11 right-0 z-40 w-[22rem] overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-xl shadow-black/40">
      <div className="grid grid-cols-3 border-b border-zinc-800 px-2 pt-1.5">
        {([
          ["emoji", "Emoji"],
          ["sticker", t("emoji.sticker")],
          ["gif", t("emoji.gif")],
        ] as const).map(([tab, label]) => (
          <button
            key={tab}
            type="button"
            className={cn(
              "border-b-2 px-2 py-2 text-[12px] transition",
              pickerTab === tab
                ? "border-brand text-brand"
                : "border-transparent text-zinc-400 hover:text-zinc-200"
            )}
            onClick={() => setPickerTab(tab)}
          >
            {label}
          </button>
        ))}
      </div>
      {pickerTab === "emoji" && (
        <EmojiPicker
          theme={theme === "light" ? Theme.LIGHT : Theme.DARK}
          emojiStyle={EmojiStyle.NATIVE}
          width="100%"
          height={320}
          lazyLoadEmojis
          searchPlaceHolder={t("emoji.search")}
          previewConfig={{ showPreview: false }}
          onEmojiClick={(data: EmojiClickData) => onPickEmoji(data.emoji)}
        />
      )}
      {pickerTab === "sticker" && (
        <div className="h-80 overflow-y-auto p-3">
          <button
            type="button"
            disabled={!isBaileys}
            className="mb-3 flex w-full items-center justify-center gap-2 rounded-lg bg-zinc-800 px-3 py-2 text-[12px] text-zinc-200 hover:bg-zinc-700 disabled:opacity-40"
            onClick={onPickStickerFile}
          >
            <Sticker className="h-4 w-4 text-amber-400" />
            {t("emoji.makeSticker")}
          </button>
          {favoriteStickers.length > 0 && (
            <>
              <div className="mb-1 text-2xs text-zinc-500">{t("emoji.favorites")}</div>
              <div className="mb-3 grid grid-cols-5 gap-1.5">
                {favoriteStickers.map((dataUrl, index) => (
                  <div
                    key={`${dataUrl.slice(-24)}-${index}`}
                    className="group/sticker relative aspect-square"
                  >
                    <button
                      type="button"
                      className="flex h-full w-full items-center justify-center rounded-lg bg-zinc-800/60 p-1 hover:bg-zinc-700"
                      onClick={() => onSendFavoriteSticker(dataUrl)}
                    >
                      <img
                        src={dataUrl}
                        alt={t("emoji.favorites")}
                        className="h-full w-full object-contain"
                      />
                    </button>
                    <button
                      type="button"
                      title={t("tooltip.removeFavorite")}
                      aria-label={t("tooltip.removeFavoriteSticker")}
                      className="absolute -right-1 -top-1 hidden h-4 w-4 items-center justify-center rounded-full bg-zinc-700 text-zinc-300 group-hover/sticker:flex hover:bg-rose-600 hover:text-white"
                      onClick={() => onRemoveFavoriteSticker(dataUrl)}
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
          <div className="mb-1 text-2xs text-zinc-500">{t("emoji.recent")}</div>
          <div className="grid grid-cols-5 gap-1.5">
            {recentStickers
              .filter((item) => !favoriteStickers.includes(item))
              .map((dataUrl, index) => (
                <button
                  key={`${dataUrl.slice(-24)}-${index}`}
                  type="button"
                  className="flex aspect-square items-center justify-center rounded-lg bg-zinc-800/60 p-1 hover:bg-zinc-700"
                  onClick={() => onSendRecentSticker(dataUrl)}
                >
                  <img
                    src={dataUrl}
                    alt={t("emoji.recent")}
                    className="h-full w-full object-contain"
                  />
                </button>
              ))}
            {!recentStickers.some(
              (item) => !favoriteStickers.includes(item)
            ) && (
              <div className="col-span-5 py-8 text-center text-[11px] text-zinc-600">
                {t("emoji.noneRecent")}
              </div>
            )}
          </div>
        </div>
      )}
      {pickerTab === "gif" && (
        <div className="flex h-80 flex-col items-center justify-center gap-3 p-6 text-center">
          <button
            type="button"
            disabled={!isBaileys}
            className="rounded-lg bg-brand px-4 py-2 text-[12px] font-medium text-white hover:brightness-110 disabled:opacity-40"
            onClick={onPickGifFile}
          >
            {t("emoji.localGif")}
          </button>
          <p className="text-[11px] leading-5 text-zinc-500">
            {t("emoji.gifHint")}
          </p>
        </div>
      )}
    </div>
  );
}
