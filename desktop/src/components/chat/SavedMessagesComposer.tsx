import { useEffect, useRef, useState, type ClipboardEvent, type FormEvent } from "react";
import { ImagePlus, Send, X } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { SAVED_MESSAGES_CHAT_ID } from "@/types/crm";
import type { AppState } from "@/store/types";
import { useI18n } from "@/i18n";

const SELF_IMAGE_MAX_BYTES = 6 * 1024 * 1024;
const SELF_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

interface StagedImage {
  file: File;
  previewUrl: string;
}

interface SavedMessagesComposerProps {
  draft: string;
  onDraftChange: (value: string) => void;
  onEnqueueMessage: AppState["enqueueOutgoingMessage"];
  onPushToast: AppState["pushToast"];
}

function readFileAsDataUrl(file: File, fallbackError: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error(fallbackError));
    reader.onerror = () => reject(new Error(fallbackError));
    reader.readAsDataURL(file);
  });
}

/** Local-only note and image composer for the Saved Messages thread. */
export function SavedMessagesComposer({
  draft,
  onDraftChange,
  onEnqueueMessage,
  onPushToast,
}: SavedMessagesComposerProps) {
  const { t } = useI18n();
  const [stagedImage, setStagedImage] = useState<StagedImage | null>(null);
  const [savingImage, setSavingImage] = useState(false);
  const stagedImageRef = useRef(stagedImage);
  stagedImageRef.current = stagedImage;
  const draftValueRef = useRef(draft);
  draftValueRef.current = draft;
  const pickerRef = useRef<HTMLInputElement>(null);
  const sendLockRef = useRef(false);

  useEffect(
    () => () => {
      if (stagedImage?.previewUrl) URL.revokeObjectURL(stagedImage.previewUrl);
    },
    [stagedImage?.previewUrl]
  );

  const stageImageFile = (file: File) => {
    if (!SELF_IMAGE_TYPES.has(file.type)) {
      onPushToast(t("runtime.selectImage"), "error");
      return;
    }
    if (file.size > SELF_IMAGE_MAX_BYTES) {
      onPushToast(t("runtime.imageTooLarge"), "error");
      return;
    }
    setStagedImage({ file, previewUrl: URL.createObjectURL(file) });
  };

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const items = Array.from(event.clipboardData.items || []);
    const file =
      items
        .find((item) => item.kind === "file" && item.type.startsWith("image/"))
        ?.getAsFile() ||
      Array.from(event.clipboardData.files || []).find((candidate) =>
        candidate.type.startsWith("image/")
      );
    if (!file) return;
    event.preventDefault();
    stageImageFile(file);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const draftSnapshot = draft;
    const body = draftSnapshot.trim();
    const image = stagedImage;
    if ((!body && !image) || sendLockRef.current) return;
    sendLockRef.current = true;
    setSavingImage(Boolean(image));
    void (async () => {
      try {
        const mediaUrl = image
          ? await readFileAsDataUrl(image.file, t("runtime.imageReadFailed"))
          : undefined;
        const messageId = onEnqueueMessage({
          body: body || t("media.image"),
          chatId: SAVED_MESSAGES_CHAT_ID,
          contactId: "",
          channelId: "local",
          deliveryStatus: "sent",
          ...(image
            ? {
                mediaType: "image",
                mediaUrl,
                mediaMime: image.file.type,
                mediaFileName: image.file.name || t("media.image"),
                mediaCaption: body || undefined,
              }
            : {}),
        });
        if (!messageId) return;
        if (draftValueRef.current === draftSnapshot) onDraftChange("");
        if (image && stagedImageRef.current === image) setStagedImage(null);
      } catch (error) {
        onPushToast(
          error instanceof Error ? error.message : t("runtime.imageReadFailed"),
          "error"
        );
      } finally {
        sendLockRef.current = false;
        setSavingImage(false);
      }
    })();
  };

  return (
    <form className="border-t border-zinc-800/90 px-4 py-2" onSubmit={handleSubmit}>
      {stagedImage && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 p-1.5">
          <img
            src={stagedImage.previewUrl}
            alt={stagedImage.file.name || t("media.image")}
            className="h-12 w-12 rounded object-cover"
          />
          <span className="min-w-0 flex-1 truncate text-xs text-zinc-400">
            {stagedImage.file.name || t("media.image")}
          </span>
          <button
            type="button"
            disabled={savingImage}
            aria-label={t("common.close")}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-800"
            onClick={() => setStagedImage(null)}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      <input
        ref={pickerRef}
        type="file"
        hidden
        accept="image/png,image/jpeg,image/gif,image/webp"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) stageImageFile(file);
        }}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label={t("composer.image")}
          title={t("composer.image")}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-800 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
          onClick={() => pickerRef.current?.click()}
        >
          <ImagePlus className="h-4 w-4" />
        </button>
        <input
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onPaste={handlePaste}
          placeholder={t("chat.selfDraft")}
          className="h-9 min-w-0 flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-3 text-[14px] text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-brand/60"
          aria-label={t("tooltip.selfMessage")}
        />
        <Button
          type="submit"
          variant="primary"
          className="!h-9 !min-h-9 !w-9 rounded-lg !px-0"
          disabled={savingImage || (!draft.trim() && !stagedImage)}
          aria-label={t("tooltip.selfMessage")}
        >
          <Send className="h-3.5 w-3.5" />
        </Button>
      </div>
    </form>
  );
}
