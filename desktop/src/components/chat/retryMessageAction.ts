import type { AppState } from "@/store/appStore";
import { gatedMediaSend } from "@/channels/mediaGate";
import {
  baileysSendDocument,
  baileysSendGif,
  baileysSendImage,
  baileysSendSticker,
  baileysSendVoice,
} from "@/lib/baileys";
import type { Message } from "@/types/crm";
import { translateCurrent } from "@/i18n";
import { isDeliveryUncertain } from "@/store/outgoingRetry";

type RetryMessageActionDeps = {
  id: string;
  message: Message | undefined;
  isBaileys: boolean;
  chatConnected: boolean;
  chatAccountId: string;
  setMediaBusyId: (id: string | null) => void;
  updateMessageDelivery: AppState["updateMessageDelivery"];
  pushToast: AppState["pushToast"];
  requestConfirm: AppState["requestConfirm"];
  readMessage?: (id: string) => Message | undefined;
};

export async function retryMessage({
  id,
  message,
  isBaileys,
  chatConnected,
  chatAccountId,
  setMediaBusyId,
  updateMessageDelivery,
  pushToast,
  requestConfirm,
  readMessage,
}: RetryMessageActionDeps) {
  if (!message || message.direction !== "out" || message.deliveryStatus !== "failed") return;
  if (isDeliveryUncertain(message)) {
    const original = message;
    if (!requestConfirm || !await requestConfirm({
      title: translateCurrent("runtime.verifyResendTitle"),
      description: translateCurrent("runtime.verifyResendDescription"),
      confirmLabel: translateCurrent("runtime.verifyResendConfirm"),
      cancelLabel: translateCurrent("runtime.verifyResendCancel"),
      tone: "danger",
    })) return;
    message = readMessage ? readMessage(id) : message;
    // 确认期间可能已收到回执、删掉消息或改了内容，不能继续发送旧快照。
    if (!message || message.deliveryStatus !== "failed" || message.body !== original.body
      || message.phoneE164 !== original.phoneE164 || message.accountId !== original.accountId
      || message.mediaUrl !== original.mediaUrl) return;
  }
  const sendAccountId = message.accountId || chatAccountId;
  if (message?.mediaType) {
    if (
      !isBaileys ||
      !chatConnected ||
      !message.phoneE164 ||
      !message.mediaUrl
    ) {
      pushToast(
        isBaileys
          ? translateCurrent("runtime.retryMediaUnavailable")
          : translateCurrent("runtime.retryPhoneMedia"),
        "error"
      );
      return;
    }
    setMediaBusyId(id);
    updateMessageDelivery(id, {
      deliveryStatus: "pending",
      lastError: undefined,
      deliveryUncertain: false,
    });
    try {
      const target = message.phoneE164;
      const mediaUrl = message.mediaUrl;
      const type = message.mediaType.toLowerCase();
      const raw = await gatedMediaSend(
        { phoneE164: target, accountId: sendAccountId },
        () =>
          type === "image"
            ? baileysSendImage(
                target,
                mediaUrl,
                message.mediaCaption || "",
                { accountId: sendAccountId }
              )
            : type === "sticker"
              ? baileysSendSticker(target, mediaUrl, sendAccountId)
              : type === "gif"
                ? baileysSendGif(
                    target,
                    mediaUrl,
                    message.mediaCaption || "",
                    sendAccountId
                  )
                : type === "document"
                  ? baileysSendDocument(
                      target,
                      mediaUrl,
                      message.mediaFileName || "file",
                      {
                        mimetype:
                          message.mediaMime || "application/octet-stream",
                        caption: message.mediaCaption,
                        accountId: sendAccountId,
                      }
                    )
                  : type === "audio"
                    ? baileysSendVoice(target, mediaUrl, {
                        seconds: message.mediaSeconds,
                        mimetype: message.mediaMime,
                        ptt: message.mediaPtt !== false,
                        accountId: sendAccountId,
                      })
                    : Promise.reject(new Error(translateCurrent("runtime.mediaRetryUnsupported")))
      );
      if (!raw) throw new Error(translateCurrent("runtime.mediaRetryUnsupported"));
      updateMessageDelivery(id, {
        deliveryStatus: "sent",
        waMessageId:
          "id" in raw && typeof raw.id === "string" ? raw.id : undefined,
        lastError: undefined,
      });
      pushToast(translateCurrent("runtime.mediaResent"), "success");
    } catch (error) {
      const detail = error instanceof Error ? error.message : translateCurrent("runtime.mediaResendFailed");
      updateMessageDelivery(id, {
        deliveryStatus: "failed",
        lastError: detail,
        deliveryUncertain: (typeof error === "object" && error !== null
          && "deliveryUncertain" in error && error.deliveryUncertain === true)
          || isDeliveryUncertain({ direction: "out", deliveryStatus: "failed", lastError: detail }),
      });
      pushToast(
        error instanceof Error ? error.message : translateCurrent("runtime.mediaResendFailed"),
        "error"
      );
    } finally {
      setMediaBusyId(null);
    }
    return;
  }

  updateMessageDelivery(id, {
    deliveryStatus: "queued",
    nextAttemptAt: new Date().toISOString(),
    lastError: undefined,
    retryCount: 0,
    deliveryUncertain: false,
  });
  pushToast(translateCurrent("runtime.requeued"), "info");
}
