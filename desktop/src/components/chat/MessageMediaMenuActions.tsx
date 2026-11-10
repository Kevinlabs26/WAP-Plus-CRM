import { useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { CloudUpload, Copy, Download, Loader2, Sparkles, Star } from "lucide-react";
import { uploadCloudImage } from "@/lib/googleDrive";
import { requestImageGeneration } from "@/lib/imageGenerationRequest";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/appStore";
import type { Message } from "@/types/crm";
import { copyImageToClipboard } from "./messageMediaUtils";
import { useI18n } from "@/i18n";
import { saveChatImage } from "@/lib/imageLibrary";
import { bridgeInvoke, isTauri } from "@/lib/bridge";
import { showDesktopNotify } from "@/lib/desktopNotify";

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
const MAX_MEDIA_SAVE_BYTES = 16 * 1024 * 1024;

async function mediaUrlToDataUrl(url: string): Promise<string> {
  if (url.startsWith("data:")) return url;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`媒体下载失败：${response.status}`);
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_MEDIA_SAVE_BYTES) {
    throw new Error("媒体超过 16 MB 限制");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("无法读取媒体数据");
  const chunks: BlobPart[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_MEDIA_SAVE_BYTES) {
      await reader.cancel();
      throw new Error("媒体超过 16 MB 限制");
    }
    const chunk = new Uint8Array(value.byteLength);
    chunk.set(value);
    chunks.push(chunk);
  }
  const blob = new Blob(chunks, {
    type: response.headers.get("content-type") || "application/octet-stream",
  });
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error("媒体读取失败"));
    reader.readAsDataURL(blob);
  });
}

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
  const [savingMedia, setSavingMedia] = useState(false);
  const [preparingMedia, setPreparingMedia] = useState(false);
  const [saveProgress, setSaveProgress] = useState(0);

  const downloadDataUrl = async (dataUrl: string, filename: string) => {
    if (isTauri()) {
      const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      setSavingMedia(true);
      setPreparingMedia(false);
      setSaveProgress(0);
      let unlisten: (() => void) | undefined;
      try {
        setPreparingMedia(!dataUrl.startsWith("data:"));
        const saveDataUrl = await mediaUrlToDataUrl(dataUrl);
        setPreparingMedia(false);
        unlisten = await listen<{
          requestId: string;
          written: number;
          total: number;
        }>("chat-media-save-progress", ({ payload }) => {
          if (payload.requestId === requestId && payload.total > 0) {
            setSaveProgress(
              Math.min(99, Math.round((payload.written / payload.total) * 100))
            );
          }
        }).catch(() => undefined);
        const saved = await bridgeInvoke<{ fileName: string; path: string }>(
          "save_chat_media",
          { dataUrl: saveDataUrl, filename, requestId }
        );
        setSaveProgress(100);
        const notified = await showDesktopNotify({
          title: t("messageMenu.savedTitle", { name: saved.fileName }),
          body: t("messageMenu.savedPath", { path: saved.path }),
          tag: `saved-media:${requestId}`,
          action: "downloads",
          onClick: () => {
            void bridgeInvoke("open_chat_media_folder").catch((error) =>
              pushToast(String(error), "error")
            );
          },
        }).catch(() => false);
        if (!notified) pushToast(t("messageMenu.savedNoSystemNotice", {path:saved.path}), "info");
      } catch (error) {
        pushToast(
          `${t("messageMenu.saveFailed")}: ${error instanceof Error ? error.message : String(error)}`,
          "error"
        );
      } finally {
        unlisten?.();
        setSavingMedia(false);
        setPreparingMedia(false);
        onClose();
      }
      return;
    }

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
    onClose();
  };

  return (
    <>
      {mediaKind === "image" && <button type="button" className={`${ITEM_CLASS} disabled:opacity-40`} disabled={!canSave} title={!canSave?t("cloud.loadFirst"):undefined} onClick={() => {
        const source=message.mediaUrl!;
        onClose();
        void uploadCloudImage(()=>source,message.mediaFileName||`image-${message.id.slice(0,12)}`);
      }}><CloudUpload className="h-3.5 w-3.5 text-zinc-400"/>{t("cloud.upload")}</button>}
      {canSave && mediaKind === "image" && <button type="button" className={ITEM_CLASS} onClick={() => {
        try { requestImageGeneration({ source: message.mediaUrl!, title: message.mediaFileName || t("media.image"), chatId: message.chatId, mode: "portrait" }); }
        catch (error) { pushToast(String(error), "error"); }
        onClose();
      }}><Sparkles className="h-3.5 w-3.5 text-zinc-400" />{t("gallery.createFromPhoto")}</button>}
      {canSave && mediaKind === "image" && <button type="button" className={ITEM_CLASS} onClick={() => {
        void saveChatImage(message.mediaUrl!, message.mediaFileName || `image-${message.id.slice(0, 12)}`)
          .then(() => pushToast(t("gallery.saved"), "success"))
          .catch(error => pushToast(String(error), "error")).finally(onClose);
      }}><Star className="h-3.5 w-3.5 text-zinc-400" />{t("gallery.saveImage")}</button>}
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
                  pushToast(
                    `${t("messageMenu.copyImageFailed")}: ${error instanceof Error ? error.message : String(error)}`,
                    "error"
                  )
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
          className={cn(ITEM_CLASS, savingMedia && "cursor-wait opacity-80")}
          disabled={savingMedia}
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
            void downloadDataUrl(message.mediaUrl!, filename);
          }}
        >
          {savingMedia ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-brand" />
          ) : (
            <Download className="h-3.5 w-3.5 text-zinc-400" />
          )}
          {savingMedia
            ? preparingMedia
              ? t("messageMenu.preparingMedia")
              : t("messageMenu.savingProgress", { percent: saveProgress })
            : t("messageMenu.saveMedia")}
        </button>
      )}
      {savingMedia && (
        <div className="px-3 pb-2" role="status" aria-live="polite">
          <div
            className="h-1.5 overflow-hidden rounded-full bg-zinc-800"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={preparingMedia ? undefined : saveProgress}
          >
            <div
              className={cn(
                "h-full rounded-full bg-brand",
                !preparingMedia && "transition-[width]"
              )}
              style={{ width: preparingMedia ? "35%" : `${saveProgress}%` }}
            />
          </div>
          <p className="mt-1 text-[10px] text-zinc-400">{t("messageMenu.downloadFolder")}</p>
        </div>
      )}
    </>
  );
}
