import type { ChatPreview, Message } from "@/types/crm";

/** Merge an imported chat-c-* thread with its duplicate bridge-chat-c-* thread. */
export function mergeImportedContactChatDuplicates(
  chats: ChatPreview[],
  messages: Message[],
  selectedChatId?: string | null
) {
  const byId = new Map(chats.map((chat) => [chat.id, chat]));
  const replacements = new Map<string, string>();
  for (const local of chats) {
    if (local.id !== `chat-${local.contactId}`) continue;
    const bridgeId = `bridge-chat-${local.contactId}`;
    const bridge = byId.get(bridgeId);
    if (!bridge) continue;
    const localOwner = local.accountId || local.phoneId || "";
    const bridgeOwner = bridge.accountId || bridge.phoneId || "";
    if (localOwner && bridgeOwner && localOwner !== bridgeOwner) continue;
    replacements.set(bridgeId, local.id);
  }
  if (!replacements.size) {
    return { chats, messages, selectedChatId, replacements, changed: false };
  }

  const bridgeByLocal = new Map<string, ChatPreview>();
  for (const [bridgeId, localId] of replacements) {
    const bridge = byId.get(bridgeId);
    if (bridge) bridgeByLocal.set(localId, bridge);
  }
  const nextChats = chats
    .filter((chat) => !replacements.has(chat.id))
    .map((chat) => {
      const bridge = bridgeByLocal.get(chat.id);
      if (!bridge) return chat;
      const bridgeIsNewer =
        (bridge.updatedAt || "") >= (chat.updatedAt || "");
      return {
        ...chat,
        contactName: chat.contactName || bridge.contactName,
        lastMessage: bridgeIsNewer
          ? bridge.lastMessage || chat.lastMessage
          : chat.lastMessage || bridge.lastMessage,
        updatedAt: bridgeIsNewer ? bridge.updatedAt : chat.updatedAt,
        unread: Math.max(chat.unread || 0, bridge.unread || 0),
        pinned: chat.pinned || bridge.pinned,
        archived: chat.archived || bridge.archived,
        mutedUntil: chat.mutedUntil ?? bridge.mutedUntil,
        isGroup: chat.isGroup || bridge.isGroup,
      };
    });
  const nextMessages = messages.map((message) => {
    const chatId = replacements.get(message.chatId);
    return chatId ? { ...message, chatId } : message;
  });
  return {
    chats: nextChats,
    messages: nextMessages,
    selectedChatId: selectedChatId
      ? replacements.get(selectedChatId) || selectedChatId
      : selectedChatId,
    replacements,
    changed: true,
  };
}
