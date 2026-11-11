import type { ChannelId } from "@/channels";
import { gatedMediaSend } from "@/channels/mediaGate";
import type { AppState } from "@/store/appStore";
import { baileysSendDocument, baileysSendVideo } from "@/lib/baileys";
import { translateCurrent } from "@/i18n";
import { cacheMediaBlob } from "@/lib/mediaCache";

type SendResult = object;

type SendFileMessageDeps = {
  requiredMinGapSec?: number;
  persistBeforeSend?: () => Promise<void>;
  canSend?: () => boolean;
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
  const nativeVideo = deps.isBaileys && (file.type === "video/mp4" || /\.mp4$/i.test(file.name));
  const streamFile=deps.isBaileys&&!nativeVideo&&file.size>14*1024*1024;
  if (file.size > (deps.isBaileys ? 100 : 14) * 1024 * 1024) {
    deps.pushToast(translateCurrent(nativeVideo ? "runtime.videoTooLarge" : deps.isBaileys ? "runtime.largeFileTooLarge" : "runtime.fileTooLarge"), "error");
    return false;
  }
  deps.setSending(true);
  const caption = captionOverride ?? deps.getDraftReply();
  let msgId: string | null = null;
  let lastPercent = -1;
  const onUploadProgress = (loaded: number, total: number) => {
    const percent = Math.min(100, Math.floor(loaded / total * 100));
    if (!msgId || percent === lastPercent) return;
    lastPercent = percent;
    deps.patchMessage(msgId, {mediaUpload:{percent, stage:percent === 100 ? "waiting" : "uploading"}});
  };
  try {
    let dataUrl = nativeVideo || streamFile ? "" : await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = reader.onabort = () => reject(new Error(translateCurrent("runtime.fileReadFailed")));
      reader.readAsDataURL(file);
    });
    msgId = deps.enqueueOutgoingMessage({
      body: caption || `${nativeVideo ? "[视频]" : "[文件]"} ${file.name}`,
      chatId: deps.chatId,
      phoneE164: recipient,
      contactId: contact.id,
      channelId: deps.channelId,
      deviceId: deps.selectedPhoneId,
      accountId: deps.chatAccountId || undefined,
      deliveryStatus: "pending",
      mediaType: nativeVideo ? "video" : undefined,
    });
    if (msgId) {
      if (nativeVideo || streamFile) {
        dataUrl = await cacheMediaBlob(msgId, file);
      }
      deps.patchMessage(msgId, {
        mediaType: nativeVideo ? "video" : "document",
        mediaUrl: dataUrl,
        mediaFileName: file.name,
        mediaMime: nativeVideo ? "video/mp4" : file.type,
        mediaCaption: caption || undefined,
      });
    }
    if ((nativeVideo || streamFile) && !msgId) throw new Error("无法保存附件消息，请重试");
    if (!msgId && deps.requiredMinGapSec !== undefined) throw new Error("无法保存出站消息，群发已停止");
    await deps.persistBeforeSend?.();
    const raw = deps.isBaileys
      ? await gatedMediaSend(
          { phoneE164: recipient, accountId: deps.chatAccountId },
          () =>
            nativeVideo ? baileysSendVideo(recipient, file, caption, deps.chatAccountId, deps.canSend, onUploadProgress) : baileysSendDocument(recipient, streamFile?file:dataUrl, file.name, {
              mimetype: file.type || "application/octet-stream",
              caption,
              accountId: deps.chatAccountId,
              canSend: deps.canSend,
              onUploadProgress: streamFile?onUploadProgress:undefined,
            }),
          deps.canSend,
          deps.requiredMinGapSec
        )
      : await gatedMediaSend(
          { phoneE164: recipient, accountId: deps.chatAccountId },
          () => deps.openAndroidMediaShare(file, dataUrl, caption, recipient),
          deps.canSend,
          deps.requiredMinGapSec
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
          mediaUpload: undefined,
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
        mediaUpload: undefined,
        lastError: message,
        deliveryUncertain: !!e && typeof e === "object" && "deliveryUncertain" in e && e.deliveryUncertain === true,
      });
    }
    deps.pushToast(message, "error");
    if (deps.requiredMinGapSec !== undefined) throw e;
    return false;
  } finally {
    deps.setSending(false);
  }
}
