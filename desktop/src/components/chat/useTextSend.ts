import { useRef, type MutableRefObject } from "react";
import type { ChannelId } from "@/channels";
import type { AppState } from "@/store/appStore";
import { useAppStore } from "@/store/appStore";
import type { ChatPreview, Contact, Message } from "@/types/crm";
import { resolveSendTarget } from "@/lib/utils";
import { baileysPresence } from "@/lib/baileys";
import { resolveMentionsForSend } from "@/lib/groupMention";
import { resolveMessageKeyFrom } from "./resolveMessageKey";
import { editMessageAction } from "./editMessageAction";
import { queueTextMessage } from "./queueTextMessage";
import { sendTextMessage } from "./sendTextMessage";
import { translateCurrent } from "@/i18n";

export type ComposerReplyTo = {
  id: string;
  body: string;
  direction: "in" | "out";
};

type UseTextSendOptions = {
  sending: boolean;
  setSending: (sending: boolean) => void;
  guardBlockedSend: () => boolean;
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  chatMessages: Message[];
  chatConnected: boolean;
  chatAccountId: string;
  setDraftReply: AppState["setDraftReply"];
  getDraft?: () => string;
  replyTo: ComposerReplyTo | null;
  setReplyTo: (v: ComposerReplyTo | null) => void;
  pushToast: AppState["pushToast"];
  stickToBottom: () => void;
  activeContact: Contact | null | undefined;
  activeChat: ChatPreview | undefined;
  isBaileys: boolean;
  selectedChatId: string | null;
  selectedContactId: string | null;
  updateContact: AppState["updateContact"];
  accountConnecting: boolean;
  needsScan: boolean;
  channelId: ChannelId;
  selectedPhoneId: string | null;
  enqueueOutgoingMessage: AppState["enqueueOutgoingMessage"];
  patchMessage: AppState["patchMessage"];
  updateMessageDelivery: AppState["updateMessageDelivery"];
  mentionTrackerRef: MutableRefObject<
    { token: string; jid: string; everyone?: boolean }[]
  >;
  groupMembers: { jid: string; label: string; phoneE164?: string }[];
  setBaileysLoginOpen: AppState["setBaileysLoginOpen"];
};

/**
 * 文本消息发送管线（含编辑已发消息、离线入队、@提及、引用），
 * 从 ChatPanel 抽离。返回 sendText。
 */
export function useTextSend(opts: UseTextSendOptions) {
  // React 的 sending 状态更新是异步的；Enter + 点击发送按钮在同一帧内
  // 可能同时进入，导致一次输入被 enqueue 两次。
  const sendLockRef = useRef(false);
  const resolveMessageKey = (m: Message) =>
    resolveMessageKeyFrom(
      m,
      useAppStore.getState().contacts,
      opts.selectedContactId
    );

  const sendText = async () => {
    const text = (opts.getDraft?.() ?? useAppStore.getState().draftReply).trim();
    if (!text || opts.sending || sendLockRef.current) return;
    if (!opts.guardBlockedSend()) return;
    sendLockRef.current = true;

    try {
      // 编辑已发消息
      if (opts.editingId) {
      const target =
        opts.chatMessages.find((m) => m.id === opts.editingId) ||
        useAppStore.getState().messages.find((m) => m.id === opts.editingId);
      const key = target ? resolveMessageKey(target) : null;
      await editMessageAction({
        message: target,
        messageKey: key,
        chatConnected: opts.chatConnected,
        accountId: opts.chatAccountId,
        text,
        setSending: opts.setSending,
        updateMessageDelivery: opts.updateMessageDelivery,
        setDraftReply: opts.setDraftReply,
        setEditingId: opts.setEditingId,
        setReplyTo: opts.setReplyTo,
        pushToast: opts.pushToast,
      });
        return;
      }

      // 自己发消息始终跟到底部
      opts.stickToBottom();
      const contact = opts.activeContact;
    // 仅 LID 客户：channelAddress 可能空，从 contact/chat id 恢复
    const recipient = resolveSendTarget({
      phone: contact?.phone,
      channelAddress: opts.isBaileys ? contact?.channelAddress : undefined,
      jid: opts.isBaileys ? contact?.channelAddress : undefined,
      entityId:
        (opts.isBaileys &&
          (contact?.id || opts.selectedChatId || opts.selectedContactId)) ||
        undefined,
    });
      if (!contact || !recipient) {
        opts.pushToast(
          opts.isBaileys
            ? "当前客户没有可发送的 WhatsApp 地址（需手机号或会话 LID；可点「同步会话」后再试）"
            : "当前客户没有电话号码",
          "error"
        );
        return;
      }
      // 补写 channelAddress，避免下次再丢
      if (
        opts.isBaileys &&
        recipient.includes("@") &&
        !contact.channelAddress &&
        contact.id
      ) {
        opts.updateContact(contact.id, { channelAddress: recipient });
      }

      const quoted = !opts.replyTo
      ? undefined
      : (() => {
          const qm =
            opts.chatMessages.find((x) => x.id === opts.replyTo?.id) ||
            useAppStore
              .getState()
              .messages.find((x) => x.id === opts.replyTo?.id);
          const qk = qm ? resolveMessageKey(qm) : null;
          if (!qk) return undefined;
          return {
            id: qk.id,
            remoteJid: qk.remoteJid,
            fromMe: qk.fromMe,
            participant: qk.participant,
            body: opts.replyTo?.body || "",
          };
        })();

      // 未连上：本地入队，连上后由 SendQueueWatcher 冲刷
      if (opts.isBaileys && !opts.chatConnected) {
      const queuedId = queueTextMessage({
        text,
        chatId: opts.selectedChatId,
        recipient,
        contactId: contact.id,
        channelId: opts.channelId,
        deviceId: opts.selectedPhoneId,
        accountId: opts.chatAccountId,
        softReconnect: opts.accountConnecting,
        needsScan: opts.needsScan,
        enqueueOutgoingMessage: opts.enqueueOutgoingMessage,
        pushToast: opts.pushToast,
        setBaileysLoginOpen: opts.setBaileysLoginOpen,
        translate: (key) => translateCurrent(key),
      });
      if (queuedId && opts.replyTo) {
        opts.patchMessage(queuedId, {
          quoted: quoted || {
            id: opts.replyTo.id,
            body: opts.replyTo.body,
            fromMe: opts.replyTo.direction === "out",
          },
        });
        opts.setReplyTo(null);
      }
        return;
      }

      opts.setSending(true);
      const msgId = opts.enqueueOutgoingMessage({
      body: text,
      chatId: opts.selectedChatId,
      phoneE164: recipient,
      contactId: contact.id,
      channelId: opts.channelId,
      deviceId: opts.selectedPhoneId,
      accountId: opts.chatAccountId,
      deliveryStatus: "pending",
    });
      if (!msgId) {
        opts.setSending(false);
        opts.pushToast("无法发送：未选中会话", "error");
        return;
      }
      if (opts.replyTo) {
      opts.patchMessage(msgId, {
        quoted: {
          id: opts.replyTo.id,
          body: opts.replyTo.body,
          fromMe: opts.replyTo.direction === "out",
        },
      });
      }

      void baileysPresence("paused", {
      phoneE164: recipient.includes("@") ? undefined : recipient,
      channelAddress: recipient.includes("@") ? recipient : undefined,
      jid: recipient.includes("@") ? recipient : undefined,
      accountId: opts.chatAccountId,
      }).catch(() => undefined);

      const mentionedJid =
      contact.isGroup || opts.activeChat?.isGroup
        ? resolveMentionsForSend(
            text,
            opts.mentionTrackerRef.current,
            opts.groupMembers.map((m) => m.jid)
          )
        : undefined;

      await sendTextMessage({
      msgId,
      text,
      recipient,
      contact,
      activeChat: opts.activeChat,
      selectedPhoneId: opts.selectedPhoneId,
      channelId: opts.channelId,
      chatAccountId: opts.chatAccountId,
      settings: useAppStore.getState().settings,
      messages: useAppStore.getState().messages,
      quoted,
      mentionedJid,
      updateMessageDelivery: opts.updateMessageDelivery,
      setBaileysLoginOpen: opts.setBaileysLoginOpen,
      setReplyTo: opts.setReplyTo,
      clearDraft: () => opts.setDraftReply(""),
      clearMentions: () => {
        opts.mentionTrackerRef.current = [];
      },
      setSending: opts.setSending,
      pushToast: opts.pushToast,
      });
    } finally {
      sendLockRef.current = false;
    }
  };

  return { sendText };
}
