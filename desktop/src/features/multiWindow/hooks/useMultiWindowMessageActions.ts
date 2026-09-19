import { useCallback, useRef, useState } from "react";
import type { ChannelId } from "@/channels";
import { useForwardMessage } from "@/components/chat/useForwardMessage";
import {
  useTextSend,
  type ComposerReplyTo,
} from "@/components/chat/useTextSend";
import { useAppStore } from "@/store/appStore";
import type { ChatPreview, Contact, Message } from "@/types/crm";

type Options = {
  chat: ChatPreview;
  contact?: Contact;
  messages: Message[];
  channelId: ChannelId;
  accountId: string;
  connection: string;
  connected: boolean;
  mediaSending: boolean;
};

export function useMultiWindowMessageActions({
  chat,
  contact,
  messages,
  channelId,
  accountId,
  connection,
  connected,
  mediaSending,
}: Options) {
  const enqueueOutgoingMessage = useAppStore(
    (state) => state.enqueueOutgoingMessage
  );
  const patchMessage = useAppStore((state) => state.patchMessage);
  const updateMessageDelivery = useAppStore(
    (state) => state.updateMessageDelivery
  );
  const updateContact = useAppStore((state) => state.updateContact);
  const setBaileysLoginOpen = useAppStore(
    (state) => state.setBaileysLoginOpen
  );
  const pushToast = useAppStore((state) => state.pushToast);
  const chats = useAppStore((state) => state.chats);
  const contacts = useAppStore((state) => state.contacts);
  const liveAccountId = useAppStore(
    (state) => state.settings.liveBaileysAccountId
  );
  const activeAccountId = useAppStore(
    (state) => state.settings.activeAccountId
  );
  const blocklistByAccountId = useAppStore(
    (state) => state.settings.blocklistByAccountId
  );
  const blocklistJids = useAppStore(
    (state) => state.settings.blocklistJids
  );
  const hasQr = useAppStore((state) => state.baileysUi.hasQr);
  const draft = useAppStore(
    (state) => state.draftReplyByChatId[chat.id] || ""
  );
  const setChatDraft = useAppStore((state) => state.setChatDraft);
  const [textSending, setTextSending] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<ComposerReplyTo | null>(null);
  const mentionTrackerRef = useRef<
    { token: string; jid: string; everyone?: boolean }[]
  >([]);

  const setDraft = useCallback(
    (text: string) => setChatDraft(chat.id, text),
    [chat.id, setChatDraft]
  );
  const getDraft = useCallback(
    () => useAppStore.getState().draftReplyByChatId[chat.id] || "",
    [chat.id]
  );

  const { sendText } = useTextSend({
    sending: textSending || mediaSending,
    setSending: setTextSending,
    guardBlockedSend: () => true,
    editingId,
    setEditingId,
    chatMessages: messages,
    chatConnected: connected,
    chatAccountId: accountId,
    setDraftReply: setDraft,
    getDraft,
    replyTo,
    setReplyTo,
    pushToast,
    stickToBottom: () => undefined,
    activeContact: contact,
    activeChat: chat,
    isBaileys: channelId !== "android_bridge",
    selectedChatId: chat.id,
    selectedContactId: contact?.id || null,
    updateContact,
    accountConnecting: [
      "connecting",
      "reconnecting",
      "starting",
      "close",
    ].includes(connection),
    needsScan:
      connection === "qr" ||
      connection === "logged_out" ||
      (accountId === liveAccountId && hasQr),
    channelId,
    selectedPhoneId: chat.phoneId || contact?.boundPhoneId || null,
    enqueueOutgoingMessage,
    patchMessage,
    updateMessageDelivery,
    mentionTrackerRef,
    groupMembers: [],
    setBaileysLoginOpen,
  });

  const forward = useForwardMessage({
    chats,
    contacts,
    selectedContactId: contact?.id || null,
    blocklistByAccountId,
    blocklistJids,
    liveBaileysAccountId: liveAccountId,
    activeAccountId,
    pushToast,
  });

  return {
    draft,
    setDraft,
    getDraft,
    textSending,
    editingId,
    setEditingId,
    replyTo,
    setReplyTo,
    sendText,
    ...forward,
  };
}
