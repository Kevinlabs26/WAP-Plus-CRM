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

type RetryMessageActionDeps = {
  id: string;
  message: Message | undefined;
  isBaileys: boolean;
  chatConnected: boolean;
  chatAccountId: string;
  setMediaBusyId: (id: string | null) => void;
  updateMessageDelivery: AppState["updateMessageDelivery"];
  pushToast: AppState["pushToast"];
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
}: RetryMessageActionDeps) {
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
    });
    try {
      const target = message.phoneE164;
      const mediaUrl = message.mediaUrl;
      const type = message.mediaType.toLowerCase();
      const raw = await gatedMediaSend(
        { phoneE164: target, accountId: chatAccountId },
        () =>
          type === "image"
            ? baileysSendImage(
                target,
                mediaUrl,
                message.mediaCaption || "",
                { accountId: chatAccountId }
              )
            : type === "sticker"
              ? baileysSendSticker(target, mediaUrl, chatAccountId)
              : type === "gif"
                ? baileysSendGif(
                    target,
                    mediaUrl,
                    message.mediaCaption || "",
                    chatAccountId
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
                        accountId: chatAccountId,
                      }
                    )
                  : type === "audio"
                    ? baileysSendVoice(target, mediaUrl, {
                        seconds: message.mediaSeconds,
                        mimetype: message.mediaMime,
                        ptt: message.mediaPtt !== false,
                        accountId: chatAccountId,
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
      updateMessageDelivery(id, {
        deliveryStatus: "failed",
        lastError:
          error instanceof Error ? error.message : translateCurrent("runtime.mediaResendFailed"),
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
  });
  pushToast(translateCurrent("runtime.requeued"), "info");
}
