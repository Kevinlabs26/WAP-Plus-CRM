import type { ChannelId } from "@/channels";
import { gatedMediaSend } from "@/channels/mediaGate";
import type { AppState } from "@/store/appStore";
import { baileysSendDocument } from "@/lib/baileys";
import { translateCurrent } from "@/i18n";

type SendResult = object;

type SendFileMessageDeps = {
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

export async function sendFileMessage(
  file: File,
  captionOverride: string | undefined,
  deps: SendFileMessageDeps
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
  if (file.size > 14 * 1024 * 1024) {
    deps.pushToast(translateCurrent("runtime.fileTooLarge"), "error");
    return false;
  }
  deps.setSending(true);
  let msgId: string | null = null;
  try {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error(translateCurrent("runtime.fileReadFailed")));
      reader.readAsDataURL(file);
    });
    const caption = captionOverride ?? deps.getDraftReply();
    msgId = deps.enqueueOutgoingMessage({
      body: caption || `[文件] ${file.name}`,
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
        mediaType: "document",
        mediaUrl: dataUrl,
        mediaFileName: file.name,
        mediaMime: file.type,
        mediaCaption: caption || undefined,
      });
    }
    const raw = deps.isBaileys
      ? await gatedMediaSend(
          { phoneE164: recipient, accountId: deps.chatAccountId },
          () =>
            baileysSendDocument(recipient, dataUrl, file.name, {
              mimetype: file.type || "application/octet-stream",
              caption,
              accountId: deps.chatAccountId,
            })
        )
      : await gatedMediaSend(
          { phoneE164: recipient, accountId: deps.chatAccountId },
          () => deps.openAndroidMediaShare(file, dataUrl, caption, recipient)
        );
    if (msgId) {
      if (!deps.isBaileys) {
        deps.updateMessageDelivery(msgId, {
          deliveryStatus: "local",
          lastError: undefined,
        });
      } else {
        const waId = "id" in raw && typeof raw.id === "string" ? raw.id : undefined;
        const remoteJid =
          ("jid" in raw && typeof raw.jid === "string" && raw.jid) ||
          (recipient.includes("@")
            ? recipient
            : `${recipient.replace(/\D/g, "")}@s.whatsapp.net`);
        deps.updateMessageDelivery(msgId, {
          deliveryStatus: "sent",
          waMessageId: waId,
          lastError: undefined,
          ...(waId && remoteJid
            ? { waKey: { id: waId, remoteJid, fromMe: true } }
            : {}),
        });
      }
    }
    if (caption) deps.setDraftReply("");
    deps.pushToast(
      deps.isBaileys ? translateCurrent("runtime.fileSent") : translateCurrent("runtime.phoneShareConfirm"),
      "success"
    );
    return true;
  } catch (e) {
    const message = e instanceof Error ? e.message : translateCurrent("runtime.fileSendFailed");
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
