/**
 * 多号 × 同一自然人：线程聚合与撞单检测（纯函数，无 React）。
 */
import { buildPersonKey } from "@/lib/utils";
import { isWaAccountConnected } from "@/lib/accountConnection";
import { accountIdsInSameBucket } from "@/store/accountScope";
import type { WaAccount } from "@/types/account";
import type { ChatPreview, Contact, Message } from "@/types/crm";

export type PersonThreadRow = {
  contactId: string;
  chatId: string;
  accountId: string;
  /** 最近一条消息时间 ISO / 本地 sentAt */
  lastAt: string;
  lastMessage: string;
  lastDirection?: "in" | "out";
  unread: number;
  active: boolean;
  /**
   * 该号是否真有消息往来（区别于仅同步了联系人/会话档案）。
   * 撞单检测只认 hasActivity === true 的行。
   */
  hasActivity: boolean;
};

export type PersonCollision = {
  /** 是否存在 ≥2 个号在「活跃窗口」内都有往来 */
  hot: boolean;
  /** 参与撞单的 accountId */
  accountIds: string[];
  /** 可读说明 */
  summary: string;
  /** 窗口（小时） */
  windowHours: number;
};

function chatPreviewHasActivity(
  chat: Pick<ChatPreview, "lastMessage" | "unread"> | null | undefined
): boolean {
  return Boolean((chat?.lastMessage || "").trim() || (chat?.unread || 0) > 0);
}

export function resolvePersonKeyForContact(
  contact?: Pick<
    Contact,
    "personKey" | "phone" | "channelAddress" | "isGroup"
  > | null,
  chat?: Pick<ChatPreview, "isGroup"> | null
): string | undefined {
  if (!contact && !chat) return undefined;
  if (contact?.personKey) return contact.personKey;
  return buildPersonKey({
    phone: contact?.phone,
    channelAddress: contact?.channelAddress,
    isGroup: contact?.isGroup || chat?.isGroup,
  });
}

/** 同一 personKey / 同手机号的联系人（跨号） */
export function findSiblingContacts(
  contacts: Contact[],
  seed: Contact | null | undefined,
  opts?: { includeGroups?: boolean }
): Contact[] {
  if (!seed) return [];
  if (seed.isGroup && !opts?.includeGroups) return [seed];

  const key = resolvePersonKeyForContact(seed);
  const phoneDigits = (seed.phone || "").replace(/\D/g, "");

  const list = contacts.filter((c) => {
    if (c.id === seed.id) return true;
    if (c.isGroup && !opts?.includeGroups) return false;
    // 历史同步产生的空占位联系人（无 phone 无名字）：不参与兄弟聚合，避免撞单误报
    if (!(c.phone || "").trim() && !(c.name || "").trim()) return false;
    if (key && c.personKey && c.personKey === key) return true;
    if (
      phoneDigits.length >= 7 &&
      (c.phone || "").replace(/\D/g, "") === phoneDigits
    ) {
      return true;
    }
    return false;
  });

  // 按账号去重：同一 account 保留最近活跃的一条联系人
  const byAcc = new Map<string, Contact>();
  for (const c of list) {
    const acc = c.accountId || c.boundPhoneId || "";
    if (!acc) {
      byAcc.set(c.id, c);
      continue;
    }
    const prev = byAcc.get(acc);
    if (!prev) {
      byAcc.set(acc, c);
      continue;
    }
    const pt = prev.lastMessageAt || "";
    const ct = c.lastMessageAt || "";
    if (ct >= pt) byAcc.set(acc, c);
  }
  return [...byAcc.values()];
}

function lastMessageInThread(
  messages: Message[],
  contactId: string,
  chatId: string | undefined,
  accountId?: string
): Message | undefined {
  let best: Message | undefined;
  for (const m of messages) {
    // 系统事件 / 群变更广播不算「真实往来」
    if (m.mediaType === "system" || m.systemKind) continue;
    const hit =
      (chatId && m.chatId === chatId) ||
      m.contactId === contactId ||
      m.chatId === `bridge-chat-${contactId}`;
    if (!hit) continue;
    // 同联系人跨号：消息必须归属当前账号，否则会把 A 号的消息算成 B 号的往来
    if (accountId && m.accountId && m.accountId !== accountId) continue;
    if (!best || m.sentAt >= best.sentAt) best = m;
  }
  return best;
}

/**
 * 构建多号线程行（供 Tab / 时间线共用）
 */
export function buildPersonThreadRows(opts: {
  contacts: Contact[];
  chats: ChatPreview[];
  messages: Message[];
  seed: Contact | null | undefined;
  selectedContactId?: string | null;
  selectedChatId?: string | null;
  focusAccountId?: string | null;
}): PersonThreadRow[] {
  const siblings = findSiblingContacts(opts.contacts, opts.seed);
  if (siblings.length <= 1) {
    // 单号也返回 0 或 1：UI 用 length>1 决定是否展示多号条
    if (siblings.length === 1) {
      const c = siblings[0];
      const owner = c.accountId || c.boundPhoneId || "";
      const contactChats = opts.chats.filter((chat) => chat.contactId === c.id);
      const candidates = contactChats.length ? contactChats : [undefined];
      const rows = candidates.map((chat): PersonThreadRow => {
        const accountId = chat?.accountId || chat?.phoneId || owner;
        const chatId = chat?.id || `bridge-chat-${c.id}`;
        const last = lastMessageInThread(
          opts.messages,
          c.id,
          chat?.id,
          accountId
        );
        const hasActivity = Boolean(last) || chatPreviewHasActivity(chat);
        return {
          contactId: c.id,
          chatId,
          accountId,
          lastAt: last?.sentAt || chat?.updatedAt || c.lastMessageAt || "",
          lastMessage: last?.body || chat?.lastMessage || "",
          lastDirection: last?.direction,
          unread: chat?.unread || 0,
          active: opts.focusAccountId
            ? accountId === opts.focusAccountId
            : chat?.id === opts.selectedChatId,
          hasActivity,
        };
      });
      const seen = new Set<string>();
      const deduped = rows.filter((row) => {
        if (!row.accountId || seen.has(row.accountId)) return false;
        seen.add(row.accountId);
        return true;
      });
      return (deduped.length > 1
        ? deduped.filter((row) => row.hasActivity)
        : deduped
      ).sort((a, b) => (b.lastAt || "").localeCompare(a.lastAt || ""));
    }
    return [];
  }

  const rows: PersonThreadRow[] = [];
  for (const c of siblings) {
    const owner = c.accountId || c.boundPhoneId || "";
    if (!owner) continue;
    const chat =
      opts.chats.find(
        (ch) =>
          ch.contactId === c.id &&
          (ch.accountId || ch.phoneId || owner) === owner
      ) || opts.chats.find((ch) => ch.contactId === c.id);
    const chatId = chat?.id || `bridge-chat-${c.id}`;
    const last = lastMessageInThread(opts.messages, c.id, chat?.id, owner);
    const hasActivity = Boolean(last) || chatPreviewHasActivity(chat);
    const active = opts.focusAccountId
      ? owner === opts.focusAccountId
      : c.id === opts.selectedContactId || chat?.id === opts.selectedChatId;
    rows.push({
      contactId: c.id,
      chatId,
      accountId: owner,
      lastAt: last?.sentAt || chat?.updatedAt || c.lastMessageAt || "",
      lastMessage: (last?.body || chat?.lastMessage || "").slice(0, 200),
      lastDirection: last?.direction,
      unread: chat?.unread || 0,
      active,
      hasActivity,
    });
  }

  // account 去重
  const seen = new Set<string>();
  const deduped = rows.filter((r) => {
    if (!r.accountId || seen.has(r.accountId)) return false;
    seen.add(r.accountId);
    return true;
  });

  return deduped
    .filter((row) => row.hasActivity)
    .sort((a, b) => (b.lastAt || "").localeCompare(a.lastAt || ""));
}

/**
 * 撞单：多个账号在 windowHours 内都有「真实消息」往来（任一方向）。
 * 仅同步了联系人/会话档案、没有真实消息的号不计入，避免误报。
 */
export function detectPersonCollision(
  rows: PersonThreadRow[],
  opts?: {
    windowHours?: number;
    accountLabel?: (accountId: string) => string;
  }
): PersonCollision | null {
  const windowHours = opts?.windowHours ?? 48;
  // 只看真有消息往来的号
  const activeRows = rows.filter((r) => r.hasActivity);
  if (activeRows.length < 2) return null;

  const now = Date.now();
  const windowMs = windowHours * 3600_000;
  const hotRows = activeRows.filter((r) => {
    if (!r.lastAt) return false;
    const t = Date.parse(r.lastAt);
    if (!Number.isFinite(t)) return false;
    return now - t <= windowMs;
  });

  if (hotRows.length < 2) {
    return {
      hot: false,
      accountIds: activeRows.map((r) => r.accountId),
      summary: `该客户在 ${activeRows.length} 个号上有往来（${windowHours}h 内仅 1 个号活跃）`,
      windowHours,
    };
  }

  const labels = hotRows.map((r) =>
    opts?.accountLabel ? opts.accountLabel(r.accountId) : r.accountId
  );
  return {
    hot: true,
    accountIds: hotRows.map((r) => r.accountId),
    summary: `撞单风险：${labels.join("、")} 在 ${windowHours}h 内都与该客户有往来`,
    windowHours,
  };
}

export function accountOnlineMap(
  accounts: WaAccount[] | undefined,
  liveBaileysAccountId: string | undefined,
  liveConnection: string | null | undefined
): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  for (const a of accounts || []) {
    map[a.id] = isWaAccountConnected(
      accounts,
      a.id,
      liveBaileysAccountId,
      liveConnection
    );
  }
  return map;
}

export function hasOutgoingPersonMessage(messages: Message[]): boolean {
  return messages.some(
    (message) =>
      message.direction === "out" &&
      message.mediaType !== "system" &&
      !message.systemKind
  );
}

/** Shared chat ids may contain multiple WhatsApp accounts; show one timeline at a time. */
export function filterMessagesForAccount(
  messages: Message[],
  accountId?: string | null,
  liveAccountId?: string | null
): Message[] {
  if (!accountId) return messages;
  const accountIds = liveAccountId
    ? accountIdsInSameBucket(accountId, liveAccountId)
    : new Set([accountId]);
  return messages.filter((message) => {
    const owner = message.accountId || message.deviceId;
    return !owner || accountIds.has(owner);
  });
}
