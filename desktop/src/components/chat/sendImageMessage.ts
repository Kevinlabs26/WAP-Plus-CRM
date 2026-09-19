import type { ChannelId } from "@/channels";
import { gatedMediaSend } from "@/channels/mediaGate";
import { baileysSendImage, baileysSendSticker } from "@/lib/baileys";
import type { AppState } from "@/store/appStore";
import { translateCurrent } from "@/i18n";

type SendResult = object;

const MAX_IMAGE_EDGE = 1600;
const IMAGE_COMPRESS_THRESHOLD = 1_500_000;
const IMAGE_QUALITY = 0.82;

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.readAsDataURL(blob);
  });
}

/** 普通图片先缩放/压缩，避免把手机原图原样塞进 Base64 JSON。 */
async function prepareImageForSend(file: File): Promise<{
  file: File;
  dataUrl: string;
}> {
  if (
    file.size <= IMAGE_COMPRESS_THRESHOLD ||
    typeof createImageBitmap !== "function"
  ) {
    return { file, dataUrl: await readAsDataUrl(file) };
  }

  let image: ImageBitmap | null = null;
  try {
    image = await createImageBitmap(file);
    const longest = Math.max(image.width, image.height);
    const scale = Math.min(1, MAX_IMAGE_EDGE / longest);
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("当前环境无法压缩图片");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", IMAGE_QUALITY)
    );
    if (!blob || blob.size >= file.size * 0.92) {
      return { file, dataUrl: await readAsDataUrl(file) };
    }
    const compressed = new File(
      [blob],
      `${file.name.replace(/\.[^.]+$/, "") || "image"}.webp`,
      { type: "image/webp", lastModified: file.lastModified }
    );
    return { file: compressed, dataUrl: await readAsDataUrl(compressed) };
  } catch {
    // 某些特殊图片/运行环境无法解码时，回退到原图发送。
    return { file, dataUrl: await readAsDataUrl(file) };
  } finally {
    image?.close();
  }
}

type SendImageMessageDeps = {
  sending: boolean;
  stickToBottom: () => void;
  resolveRecipient: () => {
    contact: { id: string } | null;
    recipient: string | null;
  };
  pushToast: AppState["pushToast"];
  isBaileys: boolean;
  chatConnected: boolean;
  setBaileysLoginOpen: AppState["setBaileysLoginOpen"];
  setSending: (sending: boolean) => void;
  toStickerDataUrl: (file: File) => Promise<string>;
  getDraftReply: () => string;
  setDraftReply: AppState["setDraftReply"];
  enqueueOutgoingMessage: AppState["enqueueOutgoingMessage"];
  chatId?: string | null;
  patchMessage: AppState["patchMessage"];
  updateMessageDelivery: AppState["updateMessageDelivery"];
  channelId: ChannelId;
  selectedPhoneId: string | null;
  chatAccountId: string | null | undefined;
  openAndroidMediaShare: (
    file: File,
    dataUrl: string,
    caption: string,
    phoneE164: string
  ) => Promise<SendResult>;
};

export async function sendImageMessage(
  file: File,
  asSticker: boolean,
  captionOverride: string | undefined,
  deps: SendImageMessageDeps
) {
  if (deps.sending) return false;
  deps.stickToBottom();
  const { contact, recipient } = deps.resolveRecipient();
  if (!contact || !recipient) {
    deps.pushToast(translateCurrent("runtime.noRecipient"), "error");
    return false;
  }
  if (deps.isBaileys && !deps.chatConnected) {
    deps.pushToast(translateCurrent("chat.connectFirst"), "error");
    deps.setBaileysLoginOpen(true);
    return false;
  }
  if (asSticker && !deps.isBaileys) {
    deps.pushToast(translateCurrent("runtime.stickerChannelRequired"), "error");
    return false;
  }
  if (!file.type.startsWith("image/")) {
    deps.pushToast(translateCurrent("runtime.selectImage"), "error");
    return false;
  }
  if (file.size > 6 * 1024 * 1024) {
    deps.pushToast(translateCurrent("runtime.imageTooLarge"), "error");
    return false;
  }
  deps.setSending(true);
  let msgId: string | null = null;
  try {
    const prepared = asSticker
      ? { file, dataUrl: await deps.toStickerDataUrl(file) }
      : await prepareImageForSend(file);
    const sendFile = prepared.file;
    const dataUrl = prepared.dataUrl;
    if (!dataUrl.startsWith("data:image")) {
      throw new Error(translateCurrent("runtime.imageReadFailed"));
    }
    const caption = asSticker ? "" : captionOverride ?? deps.getDraftReply();
    msgId = deps.enqueueOutgoingMessage({
      body: asSticker ? "[贴纸]" : caption || "[图片]",
      chatId: deps.chatId,
      phoneE164: recipient,
      contactId: contact.id,
      channelId: deps.channelId,
      deviceId: deps.selectedPhoneId,
      accountId: deps.chatAccountId || undefined,
      deliveryStatus: "pending",
    });
    if (msgId) {
      deps.patchMessage(msgId, {
        mediaType: asSticker ? "sticker" : "image",
        mediaUrl: dataUrl,
        mediaMime: asSticker ? "image/webp" : sendFile.type,
        mediaCaption: caption || undefined,
      });
    }
    const raw = deps.isBaileys
      ? await gatedMediaSend(
          { phoneE164: recipient, accountId: deps.chatAccountId },
          () =>
            asSticker
              ? baileysSendSticker(recipient, dataUrl, deps.chatAccountId)
              : baileysSendImage(recipient, dataUrl, caption, {
                  accountId: deps.chatAccountId,
                })
        )
      : await gatedMediaSend(
          { phoneE164: recipient, accountId: deps.chatAccountId },
          () => deps.openAndroidMediaShare(sendFile, dataUrl, caption, recipient)
        );
    if (msgId) {
      deps.updateMessageDelivery(msgId, {
        deliveryStatus: deps.isBaileys ? "sent" : "local",
        waMessageId:
          "id" in raw && typeof raw.id === "string" ? raw.id : undefined,
        lastError: undefined,
      });
    }
    if (caption) deps.setDraftReply("");
    deps.pushToast(
      asSticker
        ? translateCurrent("runtime.stickerSent")
        : deps.isBaileys
          ? translateCurrent("runtime.imageSent")
          : translateCurrent("runtime.phoneShareConfirm"),
      "success"
    );
    return true;
  } catch (e) {
    const message =
      e instanceof Error ? e.message : asSticker ? translateCurrent("runtime.stickerSendFailed") : translateCurrent("runtime.imageSendFailed");
    if (msgId) {
      deps.updateMessageDelivery(msgId, {
        deliveryStatus: "failed",
        lastError: message,
      });
    }
    deps.pushToast(message, "error");
    return false;
  } finally {
    deps.setSending(false);
  }
}
