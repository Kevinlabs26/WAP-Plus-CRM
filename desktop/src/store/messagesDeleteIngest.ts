/**
 * messages.delete 事件 → 从本地 messages 移除。
 */
import type { ChatPreview, Message } from "@/types/crm";

export type MessagesDeletePayload = {
  items?: {
    id?: string;
    remoteJid?: string;
    fromMe?: boolean;
    participant?: string;
  }[];
  all?: boolean;
  jid?: string;
  source?: string;
};

export function applyMessagesDelete(
  messages: Message[],
  chats: ChatPreview[],
  payload: MessagesDeletePayload,
  opts?: { deviceId?: string }
): { messages: Message[]; chats: ChatPreview[] } {
  if (!payload) return { messages, chats };
  const belongsToEventAccount = (message: Message) =>
    !opts?.deviceId ||
    !message.accountId ||
    message.accountId === opts.deviceId;

  if (payload.all && payload.jid) {
    const jid = String(payload.jid);
    const dropChatIds = new Set<string>();
    // 无法仅靠 jid 精确映射 chatId 时：按 waKey.remoteJid / 内容启发
    const next = messages.filter((m) => {
      if (!belongsToEventAccount(m)) return true;
      const remote = m.waKey?.remoteJid || m.groupJid || "";
      // 只做精确相等匹配：子串匹配会让 999@lid 连坐 1999@lid；
      // 且必须与落盘侧 clearStoredRemoteMessages 的精确删除口径一致，
      // 否则内存多删/少删都会造成重启后消息「复活」或残留。
      const hit = !!remote && remote === jid;
      if (hit) dropChatIds.add(m.chatId);
      return !hit;
    });
    // 若整会话清空，更新预览
    let nextChats = chats.map((c) => {
      if (!dropChatIds.has(c.id)) return c;
      const remain = next.filter((m) => m.chatId === c.id);
      if (!remain.length) {
        return { ...c, lastMessage: "", unread: 0 };
      }
      const last = remain[remain.length - 1];
      return {
        ...c,
        lastMessage: last.body || c.lastMessage,
        updatedAt: last.sentAt || c.updatedAt,
      };
    });
    return { messages: next, chats: nextChats };
  }

  const ids = new Set(
    (payload.items || [])
      .map((i) => String(i?.id || "").trim())
      .filter(Boolean)
  );
  if (!ids.size) return { messages, chats };

  const removedChatIds = new Set<string>();
  const next = messages.filter((m) => {
    if (!belongsToEventAccount(m)) return true;
    const hit =
      ids.has(m.id) ||
      (m.waMessageId && ids.has(m.waMessageId)) ||
      (m.waKey?.id && ids.has(m.waKey.id));
    if (hit) removedChatIds.add(m.chatId);
    return !hit;
  });

  // 一次遍历预算每 chat 的剩余最新消息与入站计数，避免 chats.map 内对每个 chat 全表 filter
  const remainLastByChat = new Map<string, Message>();
  const remainInCountByChat = new Map<string, number>();
  for (const m of next) {
    remainLastByChat.set(m.chatId, m);
    if (m.direction === "in") {
      remainInCountByChat.set(
        m.chatId,
        (remainInCountByChat.get(m.chatId) || 0) + 1
      );
    }
  }

  const nextChats = chats.map((c) => {
    if (!removedChatIds.has(c.id)) return c;
    const last = remainLastByChat.get(c.id);
    if (!last) {
      return { ...c, lastMessage: " ", unread: 0 };
    }
    return {
      ...c,
      lastMessage: last.body || c.lastMessage,
      updatedAt: last.sentAt || c.updatedAt,
      unread: Math.min(
        c.unread || 0,
        remainInCountByChat.get(c.id) || 0
      ),
    };
  });
  return { messages: next, chats: nextChats };
}
