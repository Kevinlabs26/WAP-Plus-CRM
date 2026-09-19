import { DEFAULT_ACCOUNT_ID } from "@/types/account";
import type {
  AccountDashStats,
  ChatPreview,
  Contact,
  DashboardStats,
  FollowUp,
  Message,
} from "@/types/crm";
import { readTrend7d, seedTrendFromMessages } from "./trendBuckets";

function localDayKey(d = new Date()): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

/** ISO / 日期串 → 本地 YYYY-MM-DD；无效则 "" */
export function toLocalDayKey(iso: string): string {
  if (!iso) return "";
  if (iso.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(iso)) {
    const t = Date.parse(iso);
    if (Number.isFinite(t)) return localDayKey(new Date(t));
    return iso.slice(0, 10);
  }
  return "";
}

function emptyAccountRow(accountId: string): AccountDashStats {
  return {
    accountId,
    chatsToday: 0,
    pendingReplyChats: 0,
    pendingReplies: 0,
    dealsWon: 0,
    followUpsToday: 0,
    contacts: 0,
    trend7d: [],
  };
}

function resolveAccountId(raw: string | undefined | null): string {
  const id = (raw || "").trim();
  if (id) return id;
  return DEFAULT_ACCOUNT_ID;
}

/**
 * 全局 + 按账号 + 近 7 日趋势。
 * - 今日会话 / 待回复：走 chats（避免高峰反复扫 messages）
 * - 趋势：优先读 trendBuckets 增量；无桶时扫一次 messages 并 seed
 */
export function calcStats(
  chats: ChatPreview[],
  followUps: FollowUp[],
  contacts: Contact[],
  messages?: Message[]
): DashboardStats {
  const todayLocal = localDayKey();
  const isToday = (iso: string) => toLocalDayKey(iso) === todayLocal;

  const contactAccount = new Map<string, string>();
  for (const c of contacts) {
    contactAccount.set(c.id, resolveAccountId(c.accountId));
  }

  const byAccount = new Map<string, AccountDashStats>();
  const touch = (accountId: string) => {
    let row = byAccount.get(accountId);
    if (!row) {
      row = emptyAccountRow(accountId);
      byAccount.set(accountId, row);
    }
    return row;
  };

  let chatsToday = 0;
  let pendingReplyChats = 0;
  let pendingReplies = 0;
  for (const c of chats) {
    const aid = resolveAccountId(
      c.accountId || contactAccount.get(c.contactId)
    );
    const row = touch(aid);
    if (isToday(c.updatedAt || "")) {
      chatsToday += 1;
      row.chatsToday += 1;
    }
    if (c.unread > 0) {
      pendingReplyChats += 1;
      row.pendingReplyChats += 1;
      pendingReplies += c.unread;
      row.pendingReplies += c.unread;
    }
  }

  let dealsWon = 0;
  for (const c of contacts) {
    const aid = resolveAccountId(c.accountId);
    const row = touch(aid);
    row.contacts += 1;
    if (c.stage === "won") {
      dealsWon += 1;
      row.dealsWon += 1;
    }
  }

  let followUpsToday = 0;
  for (const f of followUps) {
    if (f.done) continue;
    const due = (f.dueAt || "").slice(0, 10);
    if (!due || due > todayLocal) continue;
    followUpsToday += 1;
    // followUp 无 accountId：经联系人归属
    const fromContact = contactAccount.get(f.contactId) || DEFAULT_ACCOUNT_ID;
    touch(fromContact).followUpsToday += 1;
  }

  // 近 7 日趋势：增量桶优先
  let trend7d = readTrend7d();
  if (!trend7d && messages?.length) {
    seedTrendFromMessages(messages, true);
    trend7d = readTrend7d();
  }
  if (!trend7d) {
    const trendDays: string[] = [];
    for (let i = 6; i >= 0; i--) {
      const dt = new Date();
      dt.setHours(12, 0, 0, 0);
      dt.setDate(dt.getDate() - i);
      trendDays.push(localDayKey(dt));
    }
    trend7d = trendDays.map((day) => ({
      day,
      activeChats: 0,
      inbound: 0,
      outbound: 0,
    }));
  }

  // 确保已配置账号即使零数据也出现在表中的工作由 UI 用 waAccounts 补；
  // 这里只输出有数据的桶 + 至少全局用过的 id
  const byAccountList = [...byAccount.values()].sort((a, b) =>
    a.accountId.localeCompare(b.accountId)
  );
  for (const row of byAccountList) {
    row.trend7d = readTrend7d(new Date(), row.accountId) || [];
  }

  return {
    chatsToday,
    pendingReplyChats,
    pendingReplies,
    dealsWon,
    followUpsToday,
    byAccount: byAccountList,
    trend7d,
  };
}

export function emptyDashboardStats(): DashboardStats {
  return {
    chatsToday: 0,
    pendingReplyChats: 0,
    pendingReplies: 0,
    dealsWon: 0,
    followUpsToday: 0,
    byAccount: [],
    trend7d: [],
  };
}
