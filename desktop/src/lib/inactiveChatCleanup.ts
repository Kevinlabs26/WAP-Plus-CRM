import type { ChatPreview, Contact } from "@/types/crm";

const DAY_MS = 24 * 60 * 60 * 1000;

export function findInactiveChats(
  chats: ChatPreview[],
  contacts: Contact[],
  opts: {
    olderThanDays: number;
    now?: number;
    excludedChatId?: string | null;
  }
): ChatPreview[] {
  const contactById = new Map(contacts.map((contact) => [contact.id, contact]));
  const cutoff = (opts.now ?? Date.now()) - opts.olderThanDays * DAY_MS;

  return chats.filter((chat) => {
    if (
      chat.id === opts.excludedChatId ||
      chat.localOnly ||
      chat.pinned ||
      (chat.unread || 0) > 0 ||
      !(chat.lastMessage || "").trim()
    ) {
      return false;
    }

    const contact = contactById.get(chat.contactId);
    if (contact?.nextFollowUpAt && Date.parse(contact.nextFollowUpAt) > (opts.now ?? Date.now())) {
      return false;
    }

    const activityTimes = [chat.updatedAt, contact?.lastMessageAt]
      .map((value) => (value ? Date.parse(value) : NaN))
      .filter(Number.isFinite);
    return activityTimes.length > 0 && Math.max(...activityTimes) < cutoff;
  });
}
