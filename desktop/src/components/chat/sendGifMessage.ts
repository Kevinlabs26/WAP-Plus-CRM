import { baileysSendGif } from "@/lib/baileys";
import { gatedMediaSend } from "@/channels/mediaGate";
import type { AppState } from "@/store/appStore";
import type { Contact } from "@/types/crm";
import type { ChannelId } from "@/channels";
import { translateCurrent } from "@/i18n";

type SendGifMessageDeps = {
  file: File;
  caption: string;
  sending: boolean;
  contact: Contact | null;
  recipient: string;
  isBaileys: boolean;
  chatConnected: boolean;
  chatAccountId: string | null;
  channelId: ChannelId;
  selectedPhoneId: string | null;
  setSending: (sending: boolean) => void;
  enqueueOutgoingMessage: AppState["enqueueOutgoingMessage"];
  patchMessage: AppState["patchMessage"];
  updateMessageDelivery: AppState["updateMessageDelivery"];
  pushToast: AppState["pushToast"];
};

export async function sendGifMessage({
  file,
  caption,
  sending,
  contact,
  recipient,
  isBaileys,
  chatConnected,
  chatAccountId,
  channelId,
  selectedPhoneId,
  setSending,
  enqueueOutgoingMessage,
  patchMessage,
  updateMessageDelivery,
  pushToast,
}: SendGifMessageDeps) {
  if (sending) return false;
  if (!contact || !recipient) {
    pushToast(translateCurrent("runtime.noRecipient"), "error");
    return false;
  }
  if (!isBaileys || !chatConnected) {
    pushToast(translateCurrent("runtime.gifChannelRequired"), "error");
    return false;
  }
  if (file.type !== "image/gif" || file.size > 8_000_000) {
    pushToast(translateCurrent("runtime.gifSize"), "error");
    return false;
  }
  setSending(true);
  let msgId: string | null = null;
  try {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error(translateCurrent("runtime.gifReadFailed")));
      reader.readAsDataURL(file);
    });
    msgId = enqueueOutgoingMessage({
      body: caption || "[GIF]",
      phoneE164: recipient,
      contactId: contact.id,
      channelId,
      deviceId: selectedPhoneId,
      accountId: chatAccountId || undefined,
      deliveryStatus: "pending",
    });
    if (msgId) {
      patchMessage(msgId, {
        mediaType: "gif",
        mediaUrl: dataUrl,
        mediaMime: "image/gif",
        mediaCaption: caption || undefined,
      });
    }
    const raw = await gatedMediaSend(
      { phoneE164: recipient, accountId: chatAccountId },
      () => baileysSendGif(recipient, dataUrl, caption, chatAccountId)
    );
    if (msgId) {
      updateMessageDelivery(msgId, {
        deliveryStatus: "sent",
        waMessageId:
          "id" in raw && typeof raw.id === "string" ? raw.id : undefined,
        lastError: undefined,
      });
    }
    pushToast(translateCurrent("runtime.gifSent"), "success");
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : translateCurrent("runtime.gifSendFailed");
    if (msgId) {
      updateMessageDelivery(msgId, {
        deliveryStatus: "failed",
        lastError: message,
      });
    }
    pushToast(message, "error");
    return false;
  } finally {
    setSending(false);
  }
}
