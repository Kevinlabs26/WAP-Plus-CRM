import {
  SAVED_MESSAGES_CHAT_ID,
  SAVED_MESSAGES_CONTACT_ID,
  type ChatPreview,
  type Contact,
  type Message,
} from "@/types/crm";

type SaveMessageDeps = {
  getMessages: () => Message[];
  getChats: () => ChatPreview[];
  getContacts: () => Contact[];
  setState: (patch: { messages: Message[]; chats: ChatPreview[] }) => void;
  persist: () => void;
};

export function createSaveMessageAction({
  getMessages,
  getChats,
  getContacts,
  setState,
  persist,
}: SaveMessageDeps) {
  return {
    saveMessageToSelf(id: string) {
      const messages = getMessages();
      const chats = getChats();
      const source = messages.find((message) => message.id === id);
      if (!source || source.chatId === SAVED_MESSAGES_CHAT_ID) return false;
      if (
        messages.some(
          (message) =>
            message.chatId === SAVED_MESSAGES_CHAT_ID &&
            message.savedFromMessageId === source.id
        )
      ) {
        return false;
      }

      const now = new Date().toISOString();
      const sourceChat = chats.find((chat) => chat.id === source.chatId);
      const sourceContact = source.contactId
        ? getContacts().find((contact) => contact.id === source.contactId)
        : undefined;
      const savedMessage: Message = {
        ...source,
        id: `saved-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        chatId: SAVED_MESSAGES_CHAT_ID,
        contactId: SAVED_MESSAGES_CONTACT_ID,
        direction: "out",
        sentAt: now,
        deliveryStatus: "sent",
        channelId: "local",
        accountId: undefined,
        deviceId: undefined,
        phoneE164: undefined,
        waMessageId: undefined,
        waKey: undefined,
        savedFromMessageId: source.id,
        savedFromContactId: source.contactId || undefined,
        savedFromContactName:
          sourceContact?.name || sourceContact?.phone || sourceChat?.contactName,
        savedFromChatName: sourceChat?.contactName,
        savedFromSentAt: source.sentAt,
        savedPinned: false,
        savedTags: [],
      };
      const preview =
        source.mediaCaption ||
        source.body ||
        (source.mediaType === "audio"
          ? "[语音]"
          : source.mediaType === "image"
            ? "[图片]"
            : source.mediaType === "video"
              ? "[视频]"
              : "[媒体]");
      const savedChat: ChatPreview = {
        id: SAVED_MESSAGES_CHAT_ID,
        contactId: SAVED_MESSAGES_CONTACT_ID,
        contactName: "我的收藏",
        lastMessage: preview,
        unread: 0,
        updatedAt: now,
        phoneId: "local",
        localOnly: true,
        pinned: true,
      };
      const nextChats = chats.some((chat) => chat.id === SAVED_MESSAGES_CHAT_ID)
        ? chats.map((chat) =>
            chat.id === SAVED_MESSAGES_CHAT_ID
              ? { ...chat, ...savedChat }
              : chat
          )
        : [savedChat, ...chats];
      setState({ messages: [...messages, savedMessage], chats: nextChats });
      persist();
      return true;
    },
  };
}
