import type { ChatPreview, Contact, Message } from "@/types/crm";
import { isConversationOutgoing } from "@/lib/leadInbox";
import { isInternalContactName } from "./contactIngestHelpers";

/**
 * 纯函数：一次 ingest 批后的会话协调。
 * - 清理空壳会话（无消息/预览/未读/钉选/有效联系人则丢）
 * - 联系人真名回填会话标题（解决 history 无 pushName、后到 notify 的情况）
 */
export function reconcileChatsForContacts(
  chats: ChatPreview[],
  messages: Message[],
  contacts: Contact[]
): ChatPreview[] {
  const chatIdsWithMsg = new Set(messages.map((m) => m.chatId));
  const contactIds = new Set(contacts.map((c) => c.id));
  const kept = chats.filter((c) => {
    if (chatIdsWithMsg.has(c.id)) return true;
    if ((c.unread || 0) > 0 || c.pinned || c.archived) return true;
    const lm = (c.lastMessage || "").trim();
    if (lm && lm !== " ") return true;
    if (c.contactId && contactIds.has(c.contactId)) return true;
    return false;
  });

  const contactById = new Map(contacts.map((c) => [c.id, c]));
  let changed = false;
  const reconciled = kept.map((ch) => {
    const c = contactById.get(ch.contactId);
    if (!c) return ch;
    const good = c.name && !isInternalContactName(c.name)
      ? c.name
      : c.phone
        ? c.phone
        : "";
    if (!good) return ch;
    if (!ch.contactName || isInternalContactName(ch.contactName)) {
      changed = true;
      return { ...ch, contactName: good };
    }
    return ch;
  });
  return changed ? reconciled : kept;
}

/**
 * 纯函数：用消息库回填会话预览时间与正文（对齐官方排序，修复陈旧 updatedAt）。
 * 系统消息不参与时间回填。
 */
export function backfillChatPreviewFromMessages(
  chats: ChatPreview[],
  messages: Message[]
): ChatPreview[] {
  const lastAt = new Map<string, string>();
  const lastBody = new Map<string, string>();
  const lastDirection = new Map<string, Message["direction"]>();
  const chatsWithOutgoing = new Set<string>();
  for (const m of messages) {
    if (isConversationOutgoing(m)) chatsWithOutgoing.add(m.chatId);
    if (m.mediaType === "system" || m.systemKind) continue;
    const prev = lastAt.get(m.chatId);
    if (!prev || m.sentAt >= prev) {
      lastAt.set(m.chatId, m.sentAt);
      lastBody.set(m.chatId, m.body || "");
      lastDirection.set(m.chatId, m.direction);
    }
  }
  if (!lastAt.size && !chatsWithOutgoing.size) return chats;
  let changed = false;
  const next = chats.map((ch) => {
    const needOutgoing = chatsWithOutgoing.has(ch.id) && !ch.hasOutgoingHistory;
    const at = lastAt.get(ch.id);
    if (!at) {
      if (!needOutgoing) return ch;
      changed = true;
      return { ...ch, hasOutgoingHistory: true };
    }
    const body = lastBody.get(ch.id);
    const direction = lastDirection.get(ch.id);
    const needTime = !ch.updatedAt || at > ch.updatedAt;
    const needBody =
      body &&
      (!(ch.lastMessage || "").trim() ||
        (ch.lastMessage || "").startsWith("["));
    const needDirection = direction && ch.lastMessageDirection !== direction;
    if (!needTime && !needBody && !needDirection && !needOutgoing) return ch;
    changed = true;
    return {
      ...ch,
      updatedAt: needTime ? at : ch.updatedAt,
      lastMessage: needBody ? body! : ch.lastMessage,
      lastMessageDirection: needDirection ? direction : ch.lastMessageDirection,
      hasOutgoingHistory: needOutgoing ? true : ch.hasOutgoingHistory,
    };
  });
  return changed ? next : chats;
}
