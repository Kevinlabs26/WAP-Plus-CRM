import type { ChatPreview } from "@/types/crm";
import {
  SAVED_MESSAGES_CHAT_ID,
  SAVED_MESSAGES_CONTACT_ID,
} from "@/types/crm";
import { dropMediaCache } from "@/lib/mediaCache";
import type { AppState, SliceContext } from "./types";
import { persist } from "./persist";

export function createSavedMessagesSlice({
  set,
  get,
}: SliceContext): Pick<
  AppState,
  | "scheduleSavedMessageTomorrowFollowUp"
  | "openSavedMessageSource"
  | "deleteSavedMessages"
  | "openSavedMessages"
> {
  return {
    scheduleSavedMessageTomorrowFollowUp: (id) => {
      const state = get();
      const saved = state.messages.find(
        (item) => item.id === id && item.chatId === SAVED_MESSAGES_CHAT_ID
      );
      if (!saved) return false;

      const source = saved.savedFromMessageId
        ? state.messages.find((item) => item.id === saved.savedFromMessageId)
        : undefined;
      const contactId =
        saved.savedFromContactId ||
        source?.contactId ||
        (source?.chatId
          ? state.chats.find((chat) => chat.id === source.chatId)?.contactId
          : undefined);
      if (!contactId || !state.contacts.some((contact) => contact.id === contactId)) {
        state.pushToast("这条收藏没有关联到客户，无法创建跟进", "error");
        return false;
      }

      const note = `收藏跟进 · ${(saved.body || saved.mediaCaption || "查看这条收藏").slice(0, 100)}`;
      return Boolean(get().scheduleTomorrowFollowUp(contactId, note));
    },

    openSavedMessageSource: (id) => {
      const state = get();
      const saved = state.messages.find(
        (item) => item.id === id && item.chatId === SAVED_MESSAGES_CHAT_ID
      );
      if (!saved) return false;
      const source = saved.savedFromMessageId
        ? state.messages.find((item) => item.id === saved.savedFromMessageId)
        : undefined;
      const contactId = saved.savedFromContactId || source?.contactId;
      if (!contactId || !state.contacts.some((contact) => contact.id === contactId)) {
        state.pushToast("这条收藏没有找到原聊天", "error");
        return false;
      }

      const sourceChat = source?.chatId
        ? state.chats.find(
            (chat) => chat.id === source.chatId && chat.contactId === contactId
          )
        : undefined;
      if (sourceChat) {
        set({
          selectedChatId: sourceChat.id,
          selectedContactId: contactId,
          activeNav: "chats",
          focusMessageId: source?.id ?? saved.savedFromMessageId ?? null,
          crmPanelCollapsed: false,
        });
      } else {
        get().openContactWorkspace(contactId, {
          focusMessageId: source?.id,
        });
      }
      return true;
    },

    deleteSavedMessages: (ids) => {
      const selected = new Set(ids);
      if (!selected.size) return;
      const state = get();
      const removed = state.messages.filter(
        (item) => selected.has(item.id) && item.chatId === SAVED_MESSAGES_CHAT_ID
      );
      if (!removed.length) return;
      for (const item of removed) void dropMediaCache(item.id);
      const messages = state.messages.filter((item) => !selected.has(item.id));
      const last = messages
        .filter((item) => item.chatId === SAVED_MESSAGES_CHAT_ID)
        .sort((a, b) => a.sentAt.localeCompare(b.sentAt))
        .at(-1);
      set({
        messages,
        chats: state.chats.map((chat) =>
          chat.id === SAVED_MESSAGES_CHAT_ID
            ? {
                ...chat,
                lastMessage: last?.body || last?.mediaCaption || "",
                updatedAt: last?.sentAt || chat.updatedAt,
              }
            : chat
        ),
      });
      persist(get);
    },

    openSavedMessages: () => {
      const state = get();
      const existing = state.chats.find(
        (chat) => chat.id === SAVED_MESSAGES_CHAT_ID
      );
      const chat: ChatPreview =
        existing || {
          id: SAVED_MESSAGES_CHAT_ID,
          contactId: SAVED_MESSAGES_CONTACT_ID,
          contactName: "我的收藏",
          lastMessage: "",
          unread: 0,
          updatedAt: new Date().toISOString(),
          phoneId: "local",
          localOnly: true,
          pinned: true,
        };
      set({
        chats: existing ? state.chats : [chat, ...state.chats],
        selectedChatId: SAVED_MESSAGES_CHAT_ID,
        selectedContactId: SAVED_MESSAGES_CONTACT_ID,
        activeNav: "chats",
        focusMessageId: null,
        crmPanelCollapsed: true,
      });
      if (!existing) persist(get);
    },
  };
}