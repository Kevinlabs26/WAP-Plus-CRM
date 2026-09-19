import type { ChannelId } from "@/channels";
import type { AppState } from "@/store/appStore";
import { useAppStore } from "@/store/appStore";
import type { Contact } from "@/types/crm";
import { sendFileMessage } from "./sendFileMessage";
import { sendImageMessage } from "./sendImageMessage";
import { sendGifMessage } from "./sendGifMessage";
import { sendAudioMessage } from "./sendAudioMessage";

type UseMediaSendOptions = {
  sending: boolean;
  setSending: (sending: boolean) => void;
  guardBlockedSend: () => boolean;
  stickToBottom: () => void;
  resolveRecipient: () => {
    contact: Contact | null;
    recipient: string;
  };
  pushToast: AppState["pushToast"];
  isBaileys: boolean;
  chatConnected: boolean;
  setBaileysLoginOpen: AppState["setBaileysLoginOpen"];
  setDraftReply: AppState["setDraftReply"];
  enqueueOutgoingMessage: AppState["enqueueOutgoingMessage"];
  chatId?: string | null;
  patchMessage: AppState["patchMessage"];
  updateMessageDelivery: AppState["updateMessageDelivery"];
  channelId: ChannelId;
  selectedPhoneId: string | null;
  chatAccountId: string | null;
  openAndroidMediaShare: (
    file: File,
    dataUrl: string,
    caption: string,
    phoneE164: string
  ) => Promise<object>;
  toStickerDataUrl: (file: File) => Promise<string>;
};

/**
 * 媒体/文件/GIF/最近贴纸发送管线，从 ChatPanel 抽离。
 */
export function useMediaSend(opts: UseMediaSendOptions) {
  const sendFile = (file: File, captionOverride?: string) => {
    if (!opts.guardBlockedSend()) return false;
    return sendFileMessage(file, captionOverride, {
      sending: opts.sending,
      stickToBottom: opts.stickToBottom,
      resolveRecipient: opts.resolveRecipient,
      pushToast: opts.pushToast,
      isBaileys: opts.isBaileys,
      chatConnected: opts.chatConnected,
      setBaileysLoginOpen: opts.setBaileysLoginOpen,
      setSending: opts.setSending,
      getDraftReply: () => useAppStore.getState().draftReply.trim(),
      setDraftReply: opts.setDraftReply,
      enqueueOutgoingMessage: opts.enqueueOutgoingMessage,
      chatId: opts.chatId,
      patchMessage: opts.patchMessage,
      updateMessageDelivery: opts.updateMessageDelivery,
      channelId: opts.channelId,
      selectedPhoneId: opts.selectedPhoneId,
      chatAccountId: opts.chatAccountId,
      openAndroidMediaShare: opts.openAndroidMediaShare,
    });
  };

  const sendAudio = (file: File, captionOverride?: string) =>
    sendAudioMessage(file, captionOverride, {
      sending: opts.sending,
      setSending: opts.setSending,
      guardBlockedSend: opts.guardBlockedSend,
      stickToBottom: opts.stickToBottom,
      resolveRecipient: opts.resolveRecipient,
      pushToast: opts.pushToast,
      isBaileys: opts.isBaileys,
      chatConnected: opts.chatConnected,
      setBaileysLoginOpen: opts.setBaileysLoginOpen,
      enqueueOutgoingMessage: opts.enqueueOutgoingMessage,
      patchMessage: opts.patchMessage,
      updateMessageDelivery: opts.updateMessageDelivery,
      channelId: opts.channelId,
      selectedPhoneId: opts.selectedPhoneId,
      chatAccountId: opts.chatAccountId,
      openAndroidMediaShare: opts.openAndroidMediaShare,
    });

  const sendImage = (
    file: File,
    asSticker = false,
    captionOverride?: string
  ) => {
    if (!opts.guardBlockedSend()) return false;
    return sendImageMessage(file, asSticker, captionOverride, {
      sending: opts.sending,
      stickToBottom: opts.stickToBottom,
      resolveRecipient: opts.resolveRecipient,
      pushToast: opts.pushToast,
      isBaileys: opts.isBaileys,
      chatConnected: opts.chatConnected,
      setBaileysLoginOpen: opts.setBaileysLoginOpen,
      setSending: opts.setSending,
      toStickerDataUrl: opts.toStickerDataUrl,
      getDraftReply: () => useAppStore.getState().draftReply.trim(),
      setDraftReply: opts.setDraftReply,
      enqueueOutgoingMessage: opts.enqueueOutgoingMessage,
      chatId: opts.chatId,
      patchMessage: opts.patchMessage,
      updateMessageDelivery: opts.updateMessageDelivery,
      channelId: opts.channelId,
      selectedPhoneId: opts.selectedPhoneId,
      chatAccountId: opts.chatAccountId,
      openAndroidMediaShare: opts.openAndroidMediaShare,
    });
  };

  const sendRecentSticker = async (dataUrl: string) => {
    try {
      const blob = await (await fetch(dataUrl)).blob();
      await sendImage(
        new File([blob], "recent-sticker.webp", { type: "image/webp" }),
        true
      );
    } catch (error) {
      opts.pushToast(
        error instanceof Error ? error.message : "读取最近贴纸失败",
        "error"
      );
    }
  };

  const sendGif = async (file: File, caption = "") => {
    if (!opts.guardBlockedSend()) return false;
    const { contact, recipient } = opts.resolveRecipient();
    return sendGifMessage({
      file,
      caption,
      sending: opts.sending,
      contact,
      recipient,
      isBaileys: opts.isBaileys,
      chatConnected: opts.chatConnected,
      chatAccountId: opts.chatAccountId,
      channelId: opts.channelId,
      selectedPhoneId: opts.selectedPhoneId,
      setSending: opts.setSending,
      enqueueOutgoingMessage: opts.enqueueOutgoingMessage,
      patchMessage: opts.patchMessage,
      updateMessageDelivery: opts.updateMessageDelivery,
      pushToast: opts.pushToast,
    });
  };

  return { sendFile, sendAudio, sendImage, sendRecentSticker, sendGif };
}
