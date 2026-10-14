import type { ChatPreview, Contact, Message } from "@/types/crm";
import { isConversationOutgoing } from "./leadInbox.ts";

export function isConversationMessage(message: Pick<Message, "direction" | "mediaType" | "systemKind" | "deliveryStatus">) {
  return !message.systemKind && message.mediaType !== "system" &&
    (message.direction === "in" || isConversationOutgoing(message));
}

/** SQLite 在启动时核对完整历史；旧备份尚无此字段时保留预览兼容。 */
export function chatHasMessageHistory(chat?: Pick<ChatPreview, "hasMessageHistory" | "lastMessage" | "unread"> | null) {
  return chat?.hasMessageHistory ?? Boolean((chat?.lastMessage || "").trim() || (chat?.unread || 0) > 0);
}

export function hideEmptySiblingChats(
  visibleChats: ChatPreview[],
  allChats: ChatPreview[],
  contactById: ReadonlyMap<string, Contact>
) {
  const activeAccountsByPhone = new Map<string, Set<string>>();
  for (const chat of allChats) {
    if (!chatHasMessageHistory(chat)) continue;
    const contact = contactById.get(chat.contactId);
    const digits = (contact?.phone || "").replace(/\D/g, "");
    if (contact?.isGroup || digits.length < 7) continue;
    const accountId = chat.accountId || chat.phoneId || contact?.accountId || chat.id;
    let accounts = activeAccountsByPhone.get(digits);
    if (!accounts) activeAccountsByPhone.set(digits, (accounts = new Set()));
    accounts.add(accountId);
  }
  return visibleChats.filter((chat) => {
    if (chatHasMessageHistory(chat)) return true;
    const contact = contactById.get(chat.contactId);
    const digits = (contact?.phone || "").replace(/\D/g, "");
    if (contact?.isGroup || digits.length < 7) return true;
    const accountId = chat.accountId || chat.phoneId || contact?.accountId || chat.id;
    return ![...(activeAccountsByPhone.get(digits) || [])].some((id) => id !== accountId);
  });
}
