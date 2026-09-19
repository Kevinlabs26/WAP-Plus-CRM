import type { Message } from "@/types/crm";
import { SAVED_MESSAGES_CHAT_ID } from "@/types/crm";

type MetadataDeps = {
  getMessages: () => Message[];
  setMessages: (updater: (messages: Message[]) => Message[]) => void;
  persist: () => void;
};

export function createSavedMessageMetadataActions({
  getMessages,
  setMessages,
  persist,
}: MetadataDeps) {
  return {
    toggleMessageStarred(id: string) {
      const message = getMessages().find((item) => item.id === id);
      if (!message) return;
      const starred = !message.starred;
      setMessages((messages) =>
        messages.map((item) =>
          item.id === id
            ? {
                ...item,
                starred,
                starredAt: starred ? new Date().toISOString() : undefined,
              }
            : item
        )
      );
      persist();
    },

    listStarredMessages() {
      return getMessages()
        .filter((message) => message.starred)
        .sort((a, b) =>
          (b.starredAt || "").localeCompare(a.starredAt || "")
        );
    },

    isMessageSaved(id: string) {
      return getMessages().some(
        (message) =>
          message.chatId === SAVED_MESSAGES_CHAT_ID &&
          message.savedFromMessageId === id
      );
    },

    toggleSavedMessagePinned(id: string) {
      const message = getMessages().find(
        (item) => item.id === id && item.chatId === SAVED_MESSAGES_CHAT_ID
      );
      if (!message) return;
      setMessages((messages) =>
        messages.map((item) =>
          item.id === id ? { ...item, savedPinned: !item.savedPinned } : item
        )
      );
      persist();
    },

    setSavedMessagesPinned(ids: string[], pinned: boolean) {
      const selected = new Set(ids);
      if (!selected.size) return;
      setMessages((messages) =>
        messages.map((item) =>
          selected.has(item.id) && item.chatId === SAVED_MESSAGES_CHAT_ID
            ? { ...item, savedPinned: pinned }
            : item
        )
      );
      persist();
    },

    setSavedMessageTags(id: string, tags: string[]) {
      const nextTags = [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))].slice(
        0,
        8
      );
      const message = getMessages().find(
        (item) => item.id === id && item.chatId === SAVED_MESSAGES_CHAT_ID
      );
      if (!message) return;
      setMessages((messages) =>
        messages.map((item) =>
          item.id === id ? { ...item, savedTags: nextTags } : item
        )
      );
      persist();
    },
  };
}
