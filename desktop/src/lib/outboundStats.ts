/**
 * 出站滚动计数（按 accountId）：供健康分 / 门闸 O(1) 使用，避免每次扫全 messages。
 * 与 rateLimit 的 stamp 窗口一致思路；可从 messages 冷启动一次。
 */

export type OutboundWindow = {
  /** 最近 1h 发送时间戳 */
  hour: number[];
  /** 最近 24h 发送时间戳 */
  day: number[];
  /** 最近 24h 触及的 chatId */
  dayChats: Map<string, number>;
};

const byAccount = new Map<string, OutboundWindow>();
let seededFromMessagesRef: unknown = null;

function windowOf(accountId: string): OutboundWindow {
  let w = byAccount.get(accountId);
  if (!w) {
    w = { hour: [], day: [], dayChats: new Map() };
    byAccount.set(accountId, w);
  }
  return w;
}

function prune(w: OutboundWindow, now: number) {
  const hourAgo = now - 3600_000;
  const dayAgo = now - 86400_000;
  w.hour = w.hour.filter((t) => t >= hourAgo);
  w.day = w.day.filter((t) => t >= dayAgo);
  for (const [chat, t] of [...w.dayChats.entries()]) {
    if (t < dayAgo) w.dayChats.delete(chat);
  }
}

/** 成功出站时记账（文本/媒体/转发统一调用） */
export function noteOutboundSend(opts: {
  accountId?: string | null;
  chatId?: string | null;
  atMs?: number;
}) {
  const aid = (opts.accountId || "").trim();
  if (!aid) return;
  const now = opts.atMs ?? Date.now();
  const w = windowOf(aid);
  w.hour.push(now);
  w.day.push(now);
  if (opts.chatId) w.dayChats.set(opts.chatId, now);
  prune(w, now);
  if (byAccount.size > 64) {
    // 简单淘汰：清空窗口
    for (const [k, v] of byAccount) {
      prune(v, now);
      if (v.day.length === 0 && k !== aid) byAccount.delete(k);
    }
  }
}

export function getOutboundCounts(
  accountId: string,
  now = Date.now()
): { sentLastHour: number; sentLastDay: number; newChatsLastDay: number } {
  const aid = (accountId || "").trim();
  if (!aid) {
    return { sentLastHour: 0, sentLastDay: 0, newChatsLastDay: 0 };
  }
  const w = windowOf(aid);
  prune(w, now);
  return {
    sentLastHour: w.hour.length,
    sentLastDay: w.day.length,
    newChatsLastDay: w.dayChats.size,
  };
}

/**
 * 从内存 messages 冷启动一次（hydrate / 切换库）。
 * 用数组引用去重，避免每次 gate 全表扫。
 */
export function seedOutboundStatsFromMessages(
  messages: {
    direction?: string;
    accountId?: string;
    deviceId?: string | null;
    chatId?: string;
    sentAt?: string;
    deliveryStatus?: string;
  }[],
  force = false
) {
  if (!force && seededFromMessagesRef === messages) return;
  seededFromMessagesRef = messages;
  byAccount.clear();
  const now = Date.now();
  const dayAgo = now - 86400_000;
  for (const m of messages) {
    if (m.direction !== "out") continue;
    // 历史消息缺省状态视为已发送；仅统计已确认出站状态。
    if (
      m.deliveryStatus &&
      !["sent", "server", "delivered", "read", "played"].includes(
        m.deliveryStatus
      )
    ) {
      continue;
    }
    const aid = (m.accountId || m.deviceId || "").trim();
    if (!aid) continue;
    const t = m.sentAt ? Date.parse(m.sentAt) : 0;
    if (!Number.isFinite(t) || t < dayAgo) continue;
    noteOutboundSend({ accountId: aid, chatId: m.chatId, atMs: t });
  }
}

export function clearOutboundStats() {
  byAccount.clear();
  seededFromMessagesRef = null;
}
