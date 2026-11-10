import {
  SAVED_MESSAGES_CHAT_ID,
  SAVED_MESSAGES_CONTACT_ID,
  type ChatPreview,
  type Contact,
  type Message,
} from "@/types/crm";
import { cacheMediaUrl, cacheMediaBlob, readMediaCache, dropMediaCache } from "@/lib/mediaCache";

type SaveMessageDeps = {
  getMessages: () => Message[];
  getChats: () => ChatPreview[];
  getContacts: () => Contact[];
  setState: (patch: { messages: Message[]; chats: ChatPreview[] }) => void;
  persist: () => void | Promise<void>;
};

export function createSaveMessageAction({
  getMessages,
  getChats,
  getContacts,
  setState,
  persist,
}: SaveMessageDeps) {
  const saving = new Set<string>();
  return {
    async saveMessageToSelf(id: string) {
      const messages = getMessages();
      const chats = getChats();
      const source = messages.find((message) => message.id === id);
      if (!source || source.chatId === SAVED_MESSAGES_CHAT_ID || saving.has(id)) return false;
      if (
        messages.some(
          (message) =>
            message.chatId === SAVED_MESSAGES_CHAT_ID &&
            message.savedFromMessageId === source.id
        )
      ) {
        return false;
      }
      saving.add(id);
      const savedId = `saved-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      let added = false;
      try {
        let mediaUrl = source.mediaUrl;
        if (["image", "sticker", "audio", "video", "gif", "document"].includes(source.mediaType || "")) {
          mediaUrl = mediaUrl?.startsWith("data:") ? mediaUrl : await readMediaCache(source.id, true);
          if (mediaUrl?.startsWith("blob:")) {
            const response = await fetch(mediaUrl);
            if (!response.ok) throw new Error("读取收藏视频失败");
            mediaUrl = await cacheMediaBlob(savedId, await response.blob());
          } else {
            if (!mediaUrl?.startsWith("data:")) throw new Error("请先加载原消息的附件，再收藏；原消息保持不变");
            await cacheMediaUrl(savedId, mediaUrl, true);
          }
          if (await readMediaCache(savedId, true) !== mediaUrl) throw new Error("收藏附件保存失败，请检查磁盘空间");
        }
        if (!getMessages().some(item => item.id === id) || getMessages().some(item => item.savedFromMessageId === id)) return false;
        const now = new Date().toISOString();
        const sourceChat = chats.find((chat) => chat.id === source.chatId);
        const sourceContact = source.contactId
          ? getContacts().find((contact) => contact.id === source.contactId)
          : undefined;
        const savedMessage: Message = {
          ...source,
          id: savedId,
          chatId: SAVED_MESSAGES_CHAT_ID,
          contactId: SAVED_MESSAGES_CONTACT_ID,
          direction: "out",
          sentAt: now,
          displayOrderAt: undefined,
          localOrderAfter: undefined,
          mediaUrl,
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
        const nextChats = getChats().some((chat) => chat.id === SAVED_MESSAGES_CHAT_ID)
          ? getChats().map((chat) =>
              chat.id === SAVED_MESSAGES_CHAT_ID
                ? { ...chat, ...savedChat }
                : chat
            )
          : [savedChat, ...getChats()];
        setState({ messages: [...getMessages(), savedMessage], chats: nextChats });
        added = true;
        await persist();
        return true;
      } catch (error) {
        if (added) {
          const messages = getMessages().filter(item => item.id !== savedId);
          const last = messages.filter(item => item.chatId === SAVED_MESSAGES_CHAT_ID).at(-1);
          setState({ messages, chats: getChats().map(chat => chat.id === SAVED_MESSAGES_CHAT_ID
            ? { ...chat, lastMessage: last?.body || "", updatedAt: last?.sentAt || chat.updatedAt } : chat) });
          await Promise.resolve(persist()).catch(() => undefined);
          added = false;
        }
        throw error;
      } finally {
        saving.delete(id);
        if (!added) await dropMediaCache(savedId);
      }
    },
  };
}
