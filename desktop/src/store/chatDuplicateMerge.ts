import type { ChatPreview, Contact, Message } from "@/types/crm";
import type { SettingsShape } from "./settingsDefaults";
import { chatHasMessageHistory } from "../lib/chatActivity.ts";

/** Keep referenced legacy threads until their drafts or tasks have been reviewed. */
export function protectedGroupChatIds(settings: SettingsShape, drafts?: Record<string, string>) {
  return new Set([
    ...Object.keys(drafts || {}),
    ...Object.keys(settings.aiAutoReplyModeByChatId || {}),
    ...(settings.aiAutoReplyManualChatIds || []),
    ...(settings.leadInbox?.dismissedChatIds || []),
    ...(settings.scheduledMessages || []).map(task => task.chatId),
    ...(settings.scheduledPlans || []).flatMap(plan => plan.items.map(item => item.chatId)),
  ]);
}

/** Merge imported duplicates and empty legacy group-invite threads, never names. */
export function mergeImportedContactChatDuplicates(
  chats: ChatPreview[],
  messages: Message[],
  selectedChatId?: string | null,
  groups?: { contacts: Contact[]; protectedIds: ReadonlySet<string> }
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
  if (groups) {
    const contactsById = new Map(groups.contacts.map(contact => [contact.id, contact]));
    const groupContacts = new Map(groups.contacts.filter(contact => contact.channelAddress?.endsWith("@g.us"))
      .map(contact => [`${contact.accountId || contact.boundPhoneId}|${contact.channelAddress}`, contact.id]));
    const chatsWithMessages = new Set(messages.map(message => message.chatId));
    for (const legacy of chats) {
      const owner = legacy.accountId || legacy.phoneId;
      if (!owner || legacy.id !== `bridge-chat-${legacy.contactId}-${owner}` ||
        chatHasMessageHistory(legacy) || chatsWithMessages.has(legacy.id) || groups.protectedIds.has(legacy.id)) continue;
      const jid = contactsById.get(legacy.contactId)?.channelAddress;
      if (!jid?.endsWith("@g.us")) continue;
      const targetContactId = groupContacts.get(`${owner}|${jid}`);
      if (!targetContactId) continue;
      const target = byId.get(`bridge-chat-${targetContactId}`) || byId.get(`chat-${targetContactId}`);
      if (!target || target.contactId !== targetContactId || (target.accountId || target.phoneId) !== owner) continue;
      // shortcut: Only empty, unreferenced invite shells are automatic; populated duplicates need review.
      replacements.set(legacy.id, replacements.get(target.id) || target.id);
    }
  }
  if (!replacements.size) {
    return { chats, messages, selectedChatId, replacements, changed: false };
  }

  const bridgeByLocal = new Map<string, ChatPreview[]>();
  for (const [bridgeId, localId] of replacements) {
    const bridge = byId.get(bridgeId);
    if (bridge) bridgeByLocal.set(localId, [...(bridgeByLocal.get(localId) || []), bridge]);
  }
  const nextChats = chats
    .filter((chat) => !replacements.has(chat.id))
    .map((chat) => {
      const duplicates = bridgeByLocal.get(chat.id);
      if (!duplicates) return chat;
      return duplicates.reduce((chat, bridge) => {
        const bridgeIsNewer = chatHasMessageHistory(bridge) &&
          (bridge.updatedAt || "") >= (chat.updatedAt || "");
        return {
          ...chat,
          contactName: chat.contactName || bridge.contactName,
          lastMessage: bridgeIsNewer
            ? bridge.lastMessage || chat.lastMessage
            : chat.lastMessage || bridge.lastMessage,
          updatedAt: bridgeIsNewer ? bridge.updatedAt : chat.updatedAt,
          lastMessageDirection: bridgeIsNewer ? bridge.lastMessageDirection ?? chat.lastMessageDirection : chat.lastMessageDirection,
          replyPendingSince: bridgeIsNewer ? bridge.replyPendingSince ?? chat.replyPendingSince : chat.replyPendingSince,
          unread: Math.max(chat.unread || 0, bridge.unread || 0),
          pinned: chat.pinned || bridge.pinned,
          archived: chat.archived || bridge.archived,
          mutedUntil: chat.mutedUntil ?? bridge.mutedUntil,
          isGroup: chat.isGroup || bridge.isGroup,
          hasOutgoingHistory:
            chat.hasOutgoingHistory || bridge.hasOutgoingHistory,
          firstConversationMessage: !chat.firstConversationMessage || bridge.firstConversationMessage &&
            (Date.parse(bridge.firstConversationMessage.at) < Date.parse(chat.firstConversationMessage.at) ||
             Date.parse(bridge.firstConversationMessage.at) === Date.parse(chat.firstConversationMessage.at) && bridge.firstConversationMessage.direction === "out")
            ? bridge.firstConversationMessage : chat.firstConversationMessage,
          lastSuccessfulOutgoing:(Date.parse(bridge.lastSuccessfulOutgoing?.at||"")||0)>(Date.parse(chat.lastSuccessfulOutgoing?.at||"")||0)?bridge.lastSuccessfulOutgoing:chat.lastSuccessfulOutgoing,
          hasMessageHistory: chat.hasMessageHistory === true || bridge.hasMessageHistory === true
            ? true : chat.hasMessageHistory ?? bridge.hasMessageHistory,
        };
      }, chat);
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
