import type { ChatPreview, Contact } from "@/types/crm";

/** 恢复被旧同步清理误删的本地联系人会话；远端通讯录空壳不创建会话。 */
export function restoreLocalContactChats(
  chats: ChatPreview[],
  contacts: Contact[]
): ChatPreview[] {
  const contactIdsWithChat = new Set(chats.map((chat) => chat.contactId));
  const missing = contacts.filter(
    (contact) =>
      contact.id.startsWith("c-") &&
      contact.source !== "broadcast" &&
      !contactIdsWithChat.has(contact.id)
  );
  if (!missing.length) return chats;
  const restoredAt = new Date().toISOString();
  return [
    ...missing.map((contact) => {
      const accountId = contact.accountId || contact.boundPhoneId || "";
      return {
        id: `chat-${contact.id}`,
        contactId: contact.id,
        contactName: contact.name || contact.phone,
        lastMessage: "",
        unread: 0,
        updatedAt: contact.lastMessageAt || restoredAt,
        phoneId: contact.boundPhoneId || accountId,
        accountId,
      } satisfies ChatPreview;
    }),
    ...chats,
  ];
}
