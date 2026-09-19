/**
 * 「今日」工作台：纯派生数据，不碰 store。
 */
import type { AccountHealth } from "@/lib/accountHealth";
import type {
  ChatPreview,
  Contact,
  FollowUp,
  Message,
} from "@/types/crm";

export function localDayKey(d = new Date()): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

/** Apply one browsing scope to every workbench queue; unknown owners stay in All. */
export function scopeTodayBoard(input: {
  contacts: Contact[];
  chats: ChatPreview[];
  messages: Message[];
  followUps: FollowUp[];
}, accountId?: string) {
  if (!accountId) return input;
  const contactOwner = new Map(input.contacts.map((c) => [c.id, c.accountId || c.boundPhoneId]));
  const chatOwner = new Map(input.chats.map((c) => [c.id, c.accountId || c.phoneId || contactOwner.get(c.contactId)]));
  const chats = input.chats.filter((c) => chatOwner.get(c.id) === accountId);
  const contactIds = new Set(chats.map((c) => c.contactId));
  for (const c of input.contacts) {
    if (contactOwner.get(c.id) === accountId) contactIds.add(c.id);
  }
  return {
    contacts: input.contacts.filter((c) => contactIds.has(c.id)),
    chats,
    messages: input.messages.filter((m) =>
      (m.accountId || m.deviceId || chatOwner.get(m.chatId) || contactOwner.get(m.contactId || "")) === accountId
    ),
    followUps: input.followUps.filter((f) => contactIds.has(f.contactId)),
  };
}

export function followUpDayKey(dueAt: string): string {
  return (dueAt || "").slice(0, 10);
}

export type TodayFollowUpBucket = {
  overdue: FollowUp[];
  dueToday: FollowUp[];
  /** 逾期 + 今日，按 dueAt 升序 */
  actionable: FollowUp[];
};

export function bucketFollowUpsForToday(
  followUps: FollowUp[],
  today = localDayKey()
): TodayFollowUpBucket {
  const pending = followUps
    .filter((f) => !f.done)
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const overdue = pending.filter((f) => followUpDayKey(f.dueAt) < today);
  const dueToday = pending.filter((f) => followUpDayKey(f.dueAt) === today);
  return {
    overdue,
    dueToday,
    actionable: [...overdue, ...dueToday],
  };
}

/** 未读会话，最近活跃优先 */
export function listUnreadChats(
  chats: ChatPreview[],
  limit = 12
): ChatPreview[] {
  return chats
    .filter((c) => (c.unread || 0) > 0)
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))
    .slice(0, limit);
}

export type FailedOutboundRow = {
  message: Message;
  contactName: string;
};

/** 近期发送失败（排除战役自动行可按需再滤） */
export function listRecentFailedOutbound(
  messages: Message[],
  contacts: Contact[],
  opts?: { limit?: number; withinMs?: number }
): FailedOutboundRow[] {
  const limit = opts?.limit ?? 8;
  const withinMs = opts?.withinMs ?? 48 * 3600_000;
  const now = Date.now();
  const nameById = new Map(contacts.map((c) => [c.id, c.name] as const));
  return messages
    .filter((m) => {
      if (m.direction !== "out") return false;
      if (m.deliveryStatus !== "failed") return false;
      const t = Date.parse(m.sentAt || "");
      if (Number.isFinite(t) && now - t > withinMs) return false;
      return true;
    })
    .sort((a, b) => (b.sentAt || "").localeCompare(a.sentAt || ""))
    .slice(0, limit)
    .map((message) => ({
      message,
      contactName:
        (message.contactId && nameById.get(message.contactId)) ||
        message.phoneE164 ||
        "未知联系人",
    }));
}

export type AttentionAccount = {
  health: AccountHealth;
  label: string;
  paused: boolean;
};

export function listAttentionAccounts(
  healthList: AccountHealth[],
  opts: {
    pausedIds: Set<string>;
    labelOf: (accountId: string) => string;
  }
): AttentionAccount[] {
  const rows: AttentionAccount[] = [];
  for (const h of healthList) {
    const paused = opts.pausedIds.has(h.accountId);
    if (h.level === "green" && !paused) continue;
    rows.push({
      health: h,
      label: opts.labelOf(h.accountId) || h.accountId,
      paused,
    });
  }
  rows.sort((a, b) => {
    const rank = (x: AttentionAccount) =>
      x.health.level === "red" || x.paused ? 0 : x.health.level === "yellow" ? 1 : 2;
    return rank(a) - rank(b) || a.health.score - b.health.score;
  });
  return rows;
}

export type TodaySummary = {
  overdueCount: number;
  dueTodayCount: number;
  unreadChatCount: number;
  failedCount: number;
  attentionAccountCount: number;
  /** 用于顶栏角标：需要立刻处理的量 */
  attentionScore: number;
};

export function summarizeToday(input: {
  followUps: FollowUp[];
  chats: ChatPreview[];
  failedCount: number;
  attentionAccountCount: number;
  today?: string;
}): TodaySummary {
  const b = bucketFollowUpsForToday(input.followUps, input.today);
  const unreadChatCount = input.chats.filter((c) => (c.unread || 0) > 0).length;
  const attentionScore =
    b.overdue.length * 3 +
    b.dueToday.length +
    unreadChatCount +
    input.failedCount * 2 +
    input.attentionAccountCount * 2;
  return {
    overdueCount: b.overdue.length,
    dueTodayCount: b.dueToday.length,
    unreadChatCount,
    failedCount: input.failedCount,
    attentionAccountCount: input.attentionAccountCount,
    attentionScore,
  };
}
