/**
 * chats.delete → 侧栏去掉会话（保留 CRM 联系人档案）。
 * 匹配必须保守：禁止用 includes 扫库，避免误删全列表。
 */
import type { ChatPreview, Contact, Message } from "@/types/crm";

function norm(s: string) {
  return String(s || "").trim();
}

function chatMatchesJid(
  chat: ChatPreview,
  contact: Contact | undefined,
  jid: string
): boolean {
  const j = norm(jid);
  if (!j || !j.includes("@")) return false;

  const candidates = [
    contact?.channelAddress,
    contact?.isGroup ? contact.channelAddress : "",
    // contact.id 里偶发带 jid
    contact?.id?.includes(j) ? j : "",
  ]
    .map((s) => norm(s || ""))
    .filter(Boolean);

  if (candidates.some((c) => c === j)) return true;

  // 精确：编码进 chat.id 的整段 jid（必须含 @，避免短串误伤）
  const enc = encodeURIComponent(j);
  if (chat.id === `bridge-chat-${j}` || chat.id.endsWith(enc)) return true;
  if (contact?.id === `bridge-contact-${j}` || contact?.id?.endsWith(enc))
    return true;

  return false;
}

export function applyChatsDelete(
  chats: ChatPreview[],
  messages: Message[],
  contacts: Contact[],
  jids: string[],
  deviceId?: string
): {
  chats: ChatPreview[];
  messages: Message[];
  contacts: Contact[];
  clearedSelection?: boolean;
} {
  const list = (jids || []).map(norm).filter((j) => j.includes("@"));
  if (!list.length) {
    return { chats, messages, contacts };
  }

  const contactById = new Map(contacts.map((c) => [c.id, c]));
  const dropChatIds = new Set<string>();

  for (const chat of chats) {
    // 账号隔离：会话明确归属其他账号时绝不能被本账号的删除事件波及。
    // 不能附加 phoneId 条件——旧数据 phoneId 为空会让隔离完全失效，
    // 导致 A 号删除操作连带删掉 B 号同联系人的会话与消息。
    if (deviceId && chat.accountId && chat.accountId !== deviceId) {
      continue;
    }
    const contact = contactById.get(chat.contactId);
    for (const jid of list) {
      if (chatMatchesJid(chat, contact, jid)) {
        dropChatIds.add(chat.id);
        break;
      }
    }
  }

  if (!dropChatIds.size) {
    return { chats, messages, contacts };
  }

  return {
    chats: chats.filter((c) => !dropChatIds.has(c.id)),
    messages: messages.filter((m) => !dropChatIds.has(m.chatId)),
    contacts,
    clearedSelection: true,
  };
}
