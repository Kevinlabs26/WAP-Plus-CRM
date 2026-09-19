import { displayContactLabel } from "@/lib/utils";
import type { ChatPreview, Contact } from "@/types/crm";

export function titleOf(chat: ChatPreview, contact?: Contact) {
  return displayContactLabel(
    contact?.name || chat.contactName,
    contact?.phone,
    contact?.channelAddress,
    chat.lastMessage,
    { isGroup: !!(contact?.isGroup || chat.isGroup) }
  );
}

export function phoneIdentity(chat: ChatPreview, contact?: Contact) {
  const digits = (contact?.phone || contact?.channelAddress || "").replace(/\D/g, "");
  return !contact?.isGroup && digits.length >= 7 ? `phone:${digits}` : `chat:${chat.id}`;
}
