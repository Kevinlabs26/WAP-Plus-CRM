import type { ChatPreview, Contact } from "@/types/crm";

function chatPreviewHasActivity(chat: ChatPreview): boolean {
  return Boolean((chat.lastMessage || "").trim() || (chat.unread || 0) > 0);
}

export type FolderDisplayChat = {
  chat: ChatPreview;
  accountCount: number;
  memberChatIds: string[];
};

export function collapseAllAccountFolderChats(
  chats: ChatPreview[],
  contactById: ReadonlyMap<string, Contact>
): FolderDisplayChat[] {
  const grouped = new Map<
    string,
    {
      chat: ChatPreview;
      unread: number;
      activeAccountIds: Set<string>;
      memberChatIds: string[];
    }
  >();
  for (const chat of chats) {
    const contact = contactById.get(chat.contactId);
    const digits = (contact?.phone || "").replace(/\D/g, "");
    const key =
      !contact?.isGroup && digits.length >= 7
        ? `phone:${digits}`
        : `chat:${chat.id}`;
    const accountId =
      chat.accountId || chat.phoneId || contact?.accountId || contact?.boundPhoneId || chat.id;
    const current = grouped.get(key);
    if (!current) {
      grouped.set(key, {
        chat,
        unread: chat.unread || 0,
        activeAccountIds: new Set(
          chatPreviewHasActivity(chat) ? [accountId] : []
        ),
        memberChatIds: [chat.id],
      });
      continue;
    }
    current.unread += chat.unread || 0;
    if (chatPreviewHasActivity(chat)) current.activeAccountIds.add(accountId);
    current.memberChatIds.push(chat.id);
    if (
      (chatPreviewHasActivity(chat) && !chatPreviewHasActivity(current.chat)) ||
      (chatPreviewHasActivity(chat) === chatPreviewHasActivity(current.chat) &&
        (chat.updatedAt || "") > (current.chat.updatedAt || ""))
    ) {
      current.chat = chat;
    }
  }
  return [...grouped.values()].map((item) => ({
    chat:
      item.chat.unread === item.unread
        ? item.chat
        : { ...item.chat, unread: item.unread },
    accountCount: item.activeAccountIds.size,
    memberChatIds: item.memberChatIds,
  }));
}
