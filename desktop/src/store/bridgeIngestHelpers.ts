import type { Message } from "@/types/crm";

export function ingestString(value: unknown, max = 500): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function ingestObject(
  value: unknown
): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function normalizeIngestPhone(raw: string): string {
  const s = raw.trim();
  if (!s) return "";
  // WhatsApp LID：不当作可拨打号码写入 CRM
  if (s.includes("@lid")) return "";
  if (s.includes("@s.whatsapp.net") || s.includes("@c.us")) {
    const d = s.split("@")[0].split(":")[0];
    return d && /^\d{7,15}$/.test(d) ? `+${d}` : "";
  }
  if (s.startsWith("+") && /^\+\d{7,15}$/.test(s)) return s;
  if (/^\d{7,15}$/.test(s)) return `+${s}`;
  // 超长数字串多半是内部 id
  if (/^\d{16,}$/.test(s)) return "";
  return "";
}

export function deliveryAckRank(s?: string): number {
  switch (s) {
    case "played":
      return 5;
    case "read":
      return 4;
    case "delivered":
      return 3;
    case "server":
      return 2;
    case "sent":
      return 1;
    default:
      return 0;
  }
}

function statusNumberToAck(
  st: number
): Message["deliveryStatus"] {
  if (st >= 5) return "played";
  if (st >= 4) return "read";
  if (st >= 3) return "delivered";
  if (st >= 2) return "server";
  return "sent";
}

export type MessageIdIndexFactory = (
  messages: Message[]
) => Map<string, number>;

function buildMessageIdIndex(
  messages: Message[],
  indexFactory?: MessageIdIndexFactory
): Map<string, number> {
  if (indexFactory) return indexFactory(messages);
  const byId = new Map<string, number>();
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (!m) continue;
    if (m.id) byId.set(m.id, i);
    if (m.waMessageId) byId.set(m.waMessageId, i);
    if (m.waKey?.id) byId.set(m.waKey.id, i);
    if (m.accountId) {
      if (m.id) byId.set(`${m.accountId}\0${m.id}`, i);
      if (m.waMessageId) byId.set(`${m.accountId}\0${m.waMessageId}`, i);
      if (m.waKey?.id) byId.set(`${m.accountId}\0${m.waKey.id}`, i);
    }
  }
  return byId;
}

/**
 * 纯函数：把 messages.ack 合并进 messages（仅提升 deliveryStatus）。
 * 可注入 messages 数组级 id 索引，避免每批 O(n) 重建。
 */
export function applyMessagesAck(
  messages: Message[],
  items: unknown[],
  indexFactory?: MessageIdIndexFactory,
  accountId?: string
): Message[] {
  if (!items.length) return messages;

  const byId = buildMessageIdIndex(messages, indexFactory);

  let next = messages;
  let copied = false;

  for (const raw of items) {
    const item = ingestObject(raw);
    if (!item) continue;
    const id = ingestString(item.id, 300);
    if (!id) continue;
    let ack = ingestString(item.ack, 20) as Message["deliveryStatus"];
    if (!ack) {
      const st = item.status;
      if (typeof st === "number") ack = statusNumberToAck(st);
      else continue;
    }
    const idx =
      (accountId ? byId.get(`${accountId}\0${id}`) : undefined) ?? byId.get(id);
    if (idx == null) continue;
    // 已被本批改过则读 next
    const prev = (copied ? next[idx] : messages[idx]) as Message;
    if (accountId && prev.accountId && prev.accountId !== accountId) continue;
    if (prev.direction !== "out") continue;
    // 同等级重复 ack 不重建对象（避免击穿消息缓存导致气泡闪烁）
    if (deliveryAckRank(ack) <= deliveryAckRank(prev.deliveryStatus)) continue;
    if (!copied) {
      next = messages.slice();
      copied = true;
    }
    next[idx] = {
      ...prev,
      deliveryStatus: ack,
    };
  }
  return next;
}

/** 返回 ack 变更涉及的 chatId，供增量维护 messagesByChatId */
export function applyMessagesAckWithTouch(
  messages: Message[],
  items: unknown[],
  indexFactory?: MessageIdIndexFactory
): { messages: Message[]; touchedChatIds: string[] } {
  if (!items.length) return { messages, touchedChatIds: [] };

  const byId = buildMessageIdIndex(messages, indexFactory);

  let next = messages;
  let copied = false;
  const touchedChatIds = new Set<string>();

  for (const raw of items) {
    const item = ingestObject(raw);
    if (!item) continue;
    const id = ingestString(item.id, 300);
    if (!id) continue;
    let ack = ingestString(item.ack, 20) as Message["deliveryStatus"];
    if (!ack) {
      const st = item.status;
      if (typeof st === "number") ack = statusNumberToAck(st);
      else continue;
    }
    const idx = byId.get(id);
    if (idx == null) continue;
    const prev = (copied ? next[idx] : messages[idx]) as Message;
    if (prev.direction !== "out") continue;
    // 同等级重复 ack 不重建对象（避免击穿消息缓存导致气泡闪烁）
    if (deliveryAckRank(ack) <= deliveryAckRank(prev.deliveryStatus)) continue;
    if (!copied) {
      next = messages.slice();
      copied = true;
    }
    next[idx] = { ...prev, deliveryStatus: ack };
    if (prev.chatId) touchedChatIds.add(prev.chatId);
  }
  return {
    messages: next,
    touchedChatIds: [...touchedChatIds],
  };
}
