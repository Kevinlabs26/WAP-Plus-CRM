import type { ChatPreview, Contact, Message } from "@/types/crm";

export function filterCandidateChats(
  chats: ChatPreview[],
  contactById: Map<string, Contact>,
  ignoreGroups: boolean
) {
  if (!ignoreGroups) return chats;
  return chats.filter((chat) => !(chat.isGroup || contactById.get(chat.contactId)?.isGroup));
}

export function buildLastMessageDirectionByChatId(messages: Message[]) {
  const directionByChatId = new Map<string, Message["direction"]>();
  const timeByChatId = new Map<string, string>();
  for (const message of messages) {
    if (!message.chatId || message.systemKind || message.mediaType === "system") continue;
    const previousAt = timeByChatId.get(message.chatId);
    if (!previousAt || message.sentAt >= previousAt) {
      timeByChatId.set(message.chatId, message.sentAt);
      directionByChatId.set(message.chatId, message.direction);
    }
  }
  return directionByChatId;
}

export function buildPendingChatIds(
  candidateChats: ChatPreview[],
  lastMessageDirectionByChatId: Map<string, Message["direction"]>
) {
  return new Set(
    candidateChats
      .filter((chat) => {
        const direction = chat.lastMessageDirection || lastMessageDirectionByChatId.get(chat.id);
        return direction === "in" || (!direction && chat.unread > 0);
      })
      .map((chat) => chat.id)
  );
}
