import { Copy, Download, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/appStore";
import type { Message } from "@/types/crm";
import { copyImageToClipboard } from "./messageMediaUtils";
import { useI18n } from "@/i18n";

type Props = {
  message: Message;
  mediaKind: string;
  canSave: boolean;
  stickerFavorited: boolean;
  onToggleSticker: (source: string) => Promise<void>;
  onClose: () => void;
};

const ITEM_CLASS =
  "flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-zinc-200 hover:bg-zinc-800";

export function MessageMediaMenuActions({
  message,
  mediaKind,
  canSave,
  stickerFavorited,
  onToggleSticker,
  onClose,
}: Props) {
  const pushToast = useAppStore((state) => state.pushToast);
  const { t } = useI18n();

  const downloadDataUrl = (dataUrl: string, filename: string) => {
    try {
      const anchor = document.createElement("a");
      anchor.href = dataUrl;
      anchor.download = filename;
      anchor.rel = "noopener";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      pushToast(t("messageMenu.saveStarted"), "success");
    } catch {
      pushToast(t("messageMenu.saveFailed"), "error");
    }
  };

  return (
    <>
      {mediaKind === "sticker" && canSave && (
        <button
          type="button"
          className={ITEM_CLASS}
          onClick={() => {
            void onToggleSticker(message.mediaUrl!)
              .catch((error) =>
                pushToast(
                  error instanceof Error ? error.message : t("messageMenu.favoriteStickerFailed"),
                  "error"
                )
              )
              .finally(onClose);
          }}
        >
          <Star
            className={cn(
              "h-3.5 w-3.5 text-amber-400",
              stickerFavorited && "fill-amber-400"
            )}
          />
          {stickerFavorited ? t("messageMenu.unfavoriteSticker") : t("messageMenu.favoriteSticker")}
        </button>
      )}
      {canSave && (
        ["image", "sticker", "gif"].includes(mediaKind) && (
          <button
            type="button"
            className={ITEM_CLASS}
            onClick={() => {
              void copyImageToClipboard(message.mediaUrl!)
                .then(() => pushToast(t("messageMenu.imageCopied"), "success"))
                .catch((error) =>
                  pushToast(error instanceof Error ? error.message : t("messageMenu.copyImageFailed"), "error")
                )
                .finally(onClose);
            }}
          >
            <Copy className="h-3.5 w-3.5 text-zinc-400" />
            {t("messageMenu.copyImage")}
          </button>
        )
      )}
      {canSave && (
        <button
          type="button"
          className={ITEM_CLASS}
          onClick={() => {
            const mediaType = (message.mediaType || "").toLowerCase();
            let filename = message.mediaFileName?.trim();
            if (!filename) {
              const extension =
                mediaType === "audio"
                  ? "ogg"
                  : mediaType === "video" || mediaType === "gif"
                    ? "mp4"
                    : mediaType === "document"
                      ? "bin"
                      : "png";
              filename = `wap-${message.id.slice(0, 12)}.${extension}`;
            }
            downloadDataUrl(message.mediaUrl!, filename);
            onClose();
          }}
        >
          <Download className="h-3.5 w-3.5 text-zinc-400" />
          {t("messageMenu.saveMedia")}
        </button>
      )}
    </>
  );
}
