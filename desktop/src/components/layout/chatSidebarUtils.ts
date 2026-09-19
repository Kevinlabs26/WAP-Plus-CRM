import type { ChatPreview, Contact, Message } from "@/types/crm";
import type { AccountViewMode } from "@/types/account";
import { DEFAULT_ACCOUNT_ID } from "@/types/account";
import { displayContactLabel, resolveSendTarget } from "@/lib/utils";
import { chatInView, contactInView } from "@/store/accountScope";

export type ChatSortMode =
  | "recent"
  | "unread"
  | "awaiting_reply"
  | "name_asc"
  | "name_desc";

export const CHAT_SORT_OPTIONS: { id: ChatSortMode; label: string }[] = [
  { id: "recent", label: "最近消息" },
  { id: "unread", label: "未读优先" },
  { id: "awaiting_reply", label: "待回复优先" },
  { id: "name_asc", label: "名称 A → Z" },
  { id: "name_desc", label: "名称 Z → A" },
];

export function chatTarget(contact?: Contact | null, chat?: ChatPreview | null) {
  const t = resolveSendTarget({
    phone: contact?.phone,
    channelAddress: contact?.channelAddress,
    entityId: contact?.id || chat?.id,
  });
  return {
    phoneE164: contact?.phone || undefined,
    channelAddress: contact?.channelAddress || undefined,
    jid: t.includes("@") ? t : undefined,
    accountId: contact?.accountId || chat?.accountId,
  };
}

export function isGhostSelfContact(
  c: { name?: string; phone?: string },
  selfName: string
) {
  const n = (c.name || "").trim();
  const p = (c.phone || "").trim();
  if (p) return false;
  if (selfName && n === selfName) return true;
  // 单字母无号：历史「E」脏数据
  if (/^[A-Za-zÀ-ÿ]$/.test(n)) return true;
  return false;
}

/** 按消息库计算会话最后一条时间/正文/方向（比 chat.updatedAt 更准） */
export function buildChatActivityMaps(messages: Message[]) {
  const lastMsgAtByChat = new Map<string, string>();
  const lastBodyByChat = new Map<string, string>();
  const lastDirByChat = new Map<string, Message["direction"]>();
  const lastDeliveryStatusByChat = new Map<
    string,
    Message["deliveryStatus"]
  >();
  for (const m of messages) {
    // 系统事件不参与「最后聊天时间」（官方列表也不靠进群通知顶序）
    if (m.mediaType === "system" || m.systemKind) continue;
    const prev = lastMsgAtByChat.get(m.chatId);
    if (!prev || m.sentAt >= prev) {
      lastMsgAtByChat.set(m.chatId, m.sentAt);
      lastBodyByChat.set(m.chatId, m.body);
      lastDirByChat.set(m.chatId, m.direction);
      lastDeliveryStatusByChat.set(m.chatId, m.deliveryStatus);
    }
  }
  return {
    lastMsgAtByChat,
    lastBodyByChat,
    lastDirByChat,
    lastDeliveryStatusByChat,
  };
}

/**
 * 侧栏轻量路径：优先用 ChatPreview 上的 lastMessage/updatedAt，
 * 避免每次渲染扫全量 messages（上千条时主因卡顿）。
 * 仅当 preview 缺字段时才回落到 messages 扫描。
 */
export function buildChatActivityMapsFromPreviews(
  chats: ChatPreview[],
  messages?: Message[]
) {
  const lastMsgAtByChat = new Map<string, string>();
  const lastBodyByChat = new Map<string, string>();
  const lastDirByChat = new Map<string, Message["direction"]>();
  const lastDeliveryStatusByChat = new Map<
    string,
    Message["deliveryStatus"]
  >();
  // 1) preview 底稿
  for (const c of chats) {
    if (c.lastMessage || c.updatedAt) {
      lastBodyByChat.set(c.id, c.lastMessage || "");
      lastMsgAtByChat.set(c.id, c.updatedAt || "");
      if ((c.unread || 0) > 0) lastDirByChat.set(c.id, "in");
    }
  }
  // 2) 有消息库时：用「真实最后一条」覆盖时间/正文（对齐官方按最后消息排序）
  //    不能只在 preview 缺失时才扫——否则错误/过期的 updatedAt 会一直主导顺序
  if (messages && messages.length) {
    const fromMsg = buildChatActivityMaps(messages);
    for (const [id, at] of fromMsg.lastMsgAtByChat) {
      // 有真实消息则强制用消息时间（官方同源）
      lastMsgAtByChat.set(id, at);
    }
    for (const [id, body] of fromMsg.lastBodyByChat) {
      // 正文以消息库最后一条为准（比陈旧 preview 准）
      lastBodyByChat.set(id, body);
    }
    for (const [id, dir] of fromMsg.lastDirByChat) {
      lastDirByChat.set(id, dir);
    }
    for (const [id, status] of fromMsg.lastDeliveryStatusByChat) {
      lastDeliveryStatusByChat.set(id, status);
    }
  }
  return {
    lastMsgAtByChat,
    lastBodyByChat,
    lastDirByChat,
    lastDeliveryStatusByChat,
  };
}

function chatLabelFromContact(
  chat: ChatPreview,
  c: Contact | undefined,
  lastBody?: string
): string {
  return displayContactLabel(
    c?.name || chat.contactName,
    c?.phone,
    c?.channelAddress,
    lastBody,
    { isGroup: !!(c?.isGroup || chat.isGroup) }
  );
}

function localDayKey(d = new Date()): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

function chatUpdatedLocalDay(iso: string): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isFinite(t)) return localDayKey(new Date(t));
  if (iso.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(iso)) return iso.slice(0, 10);
  return "";
}

export function filterAndSortSidebarChats(opts: {
  chats: ChatPreview[];
  contacts: Contact[];
  contactById?: ReadonlyMap<string, Contact>;
  /** 可选；侧栏默认不传，避免订阅全量 messages */
  messages?: Message[];
  query: string;
  showArchived: boolean;
  selfName: string;
  /** 默认最近消息；置顶始终优先 */
  sortMode?: ChatSortMode;
  /** StatsBar 快捷筛选：全部 / 未读 / 今日有更新 */
  listFilter?: "all" | "unread" | "today";
  /** 多账号浏览范围；默认全部 */
  accountView?: AccountViewMode;
  fallbackAccountId?: string;
  /** 当前 Baileys 直播槽；用于 wa-default 兼容 */
  liveAccountId?: string;
}) {
  const sortMode = opts.sortMode ?? "recent";
  const listFilter = opts.listFilter ?? "all";
  const accountView = opts.accountView ?? { type: "all" as const };
  const fallbackAccountId = opts.fallbackAccountId || DEFAULT_ACCOUNT_ID;
  const liveAccountId = opts.liveAccountId || fallbackAccountId;
  const todayKey = localDayKey();
  // O(1) 联系人查找，避免 filter/sort 里反复 find
  const contactById =
    opts.contactById ?? new Map(opts.contacts.map((c) => [c.id, c]));
  // 有 preview 字段时不扫全量 messages；缺省才回落
  const {
    lastMsgAtByChat,
    lastBodyByChat,
    lastDirByChat,
    lastDeliveryStatusByChat,
  } =
    buildChatActivityMapsFromPreviews(opts.chats, opts.messages);
  const q = opts.query.trim().toLowerCase();

  let archivedCount = 0;
  const filteredChats: ChatPreview[] = [];
  for (const chat of opts.chats) {
    if (chat.localOnly) continue;
    if (chat.archived) archivedCount += 1;
    // 会话列表：有消息/预览/未读钉选；或仍绑定联系人的行
    const hasSignal =
      lastMsgAtByChat.has(chat.id) ||
      (chat.unread || 0) > 0 ||
      chat.pinned ||
      chat.archived ||
      !!(chat.lastMessage || "").trim() ||
      !!(chat.contactId && (chat.accountId || chat.phoneId));
    if (!hasSignal) continue;
    if (!chatInView(chat, accountView, fallbackAccountId, liveAccountId))
      continue;
    const c = contactById.get(chat.contactId);
    if (c && isGhostSelfContact(c, opts.selfName)) continue;
    if (
      !c &&
      isGhostSelfContact({ name: chat.contactName, phone: "" }, opts.selfName)
    )
      continue;
    if (opts.showArchived ? !chat.archived : !!chat.archived) continue;
    if (listFilter === "unread" && !(chat.unread > 0)) continue;
    if (
      listFilter === "today" &&
      chatUpdatedLocalDay(chat.updatedAt || "") !== todayKey
    ) {
      continue;
    }
    if (q) {
      const body = lastBodyByChat.get(chat.id) || chat.lastMessage || "";
      const label = chatLabelFromContact(chat, c, body);
      const phone = c?.phone || "";
      if (
        !chat.contactName.toLowerCase().includes(q) &&
        !label.toLowerCase().includes(q) &&
        !body.toLowerCase().includes(q) &&
        !phone.toLowerCase().includes(q)
      ) {
        continue;
      }
    }
    filteredChats.push(chat);
  }

  // 预算排序键：每个 chat 只算一次 label / 时间键，比较器只读标量
  const labelByChatId = new Map<string, string>();
  const sortKeyByChatId = new Map<string, number>();
  for (const chat of filteredChats) {
    labelByChatId.set(
      chat.id,
      chatLabelFromContact(
        chat,
        contactById.get(chat.contactId),
        lastBodyByChat.get(chat.id)
      )
    );
    const raw = lastMsgAtByChat.get(chat.id) || chat.updatedAt || "";
    let ts = 0;
    if (raw) {
      const t = /^\d{10,13}$/.test(raw) ? Number(raw) : Date.parse(raw);
      if (Number.isFinite(t)) ts = t < 1e12 ? t * 1000 : t;
    }
    sortKeyByChatId.set(chat.id, ts);
  }

  filteredChats.sort((a, b) => {
    const pin = Number(!!b.pinned) - Number(!!a.pinned);
    if (pin) return pin;

    const labelA = labelByChatId.get(a.id) || "";
    const labelB = labelByChatId.get(b.id) || "";
    const ta = sortKeyByChatId.get(a.id) || 0;
    const tb = sortKeyByChatId.get(b.id) || 0;
    const unreadA = a.unread || 0;
    const unreadB = b.unread || 0;
    const awaitA = lastDirByChat.get(a.id) === "in" ? 1 : 0;
    const awaitB = lastDirByChat.get(b.id) === "in" ? 1 : 0;

    if (sortMode === "unread") {
      if (Number(unreadB > 0) !== Number(unreadA > 0))
        return Number(unreadB > 0) - Number(unreadA > 0);
      if (unreadB !== unreadA) return unreadB - unreadA;
      if (tb !== ta) return tb - ta;
      return labelA.localeCompare(labelB, "zh");
    }

    if (sortMode === "awaiting_reply") {
      if (awaitB !== awaitA) return awaitB - awaitA;
      if (awaitA && awaitB && ta !== tb) return ta - tb;
      if (tb !== ta) return tb - ta;
      return labelA.localeCompare(labelB, "zh");
    }

    if (sortMode === "name_asc") {
      const byName = labelA.localeCompare(labelB, "zh");
      if (byName) return byName;
      return tb - ta;
    }

    if (sortMode === "name_desc") {
      const byName = labelB.localeCompare(labelA, "zh");
      if (byName) return byName;
      return tb - ta;
    }

    if (tb !== ta) {
      if (!tb) return -1;
      if (!ta) return 1;
      return ta > tb ? -1 : 1;
    }
    const bodyA = (lastBodyByChat.get(a.id) || a.lastMessage || "").trim();
    const bodyB = (lastBodyByChat.get(b.id) || b.lastMessage || "").trim();
    if (Boolean(bodyB) !== Boolean(bodyA))
      return Number(Boolean(bodyB)) - Number(Boolean(bodyA));
    if (unreadB !== unreadA) return unreadB - unreadA;
    return labelA.localeCompare(labelB, "zh");
  });

  return {
    filteredChats,
    lastBodyByChat,
    lastMsgAtByChat,
    lastDirByChat,
    lastDeliveryStatusByChat,
    archivedCount,
  };
}

export function filterSidebarContacts(
  contacts: Contact[],
  query: string,
  selfName: string,
  accountView: AccountViewMode = { type: "all" },
  fallbackAccountId = DEFAULT_ACCOUNT_ID,
  liveAccountId?: string
) {
  const q = query.trim().toLowerCase();
  return contacts.filter(
    (contact) =>
      !isGhostSelfContact(contact, selfName) &&
      contactInView(
        contact,
        accountView,
        fallbackAccountId,
        liveAccountId || fallbackAccountId
      ) &&
      (!q ||
        contact.name.toLowerCase().includes(q) ||
        contact.phone.includes(q) ||
        displayContactLabel(
          contact.name,
          contact.phone,
          contact.channelAddress,
          null,
          { isGroup: !!contact.isGroup }
        )
          .toLowerCase()
          .includes(q))
  );
}

export type GroupChatFilter =
  | "all"
  | "hidden"
  | "only"
  | "unread"
  | "pinned"
  | "mentions";

export type GroupChatCounts = Record<GroupChatFilter, number>;

export function findUnreadMentionedChatIds(
  chats: ChatPreview[],
  messagesByChatId: Readonly<Record<string, Message[]>>
): Set<string> {
  const ids = new Set<string>();
  for (const chat of chats) {
    let unreadLeft = chat.unread;
    if (unreadLeft <= 0) continue;
    const messages = messagesByChatId[chat.id] || [];
    for (let i = messages.length - 1; i >= 0 && unreadLeft > 0; i -= 1) {
      const message = messages[i];
      if (!message || message.direction !== "in") continue;
      if (message.mentionedMe) {
        ids.add(chat.id);
        break;
      }
      unreadLeft -= 1;
    }
  }
  return ids;
}

export function filterGroupChats(
  chats: ChatPreview[],
  contactById: ReadonlyMap<string, Contact>,
  mode: GroupChatFilter,
  query: string,
  mentionedChatIds: ReadonlySet<string> = new Set()
): { chats: ChatPreview[]; hiddenCount: number } {
  if (mode === "all" || query.trim()) return { chats, hiddenCount: 0 };
  const visible: ChatPreview[] = [];
  let hiddenCount = 0;
  for (const chat of chats) {
    const isGroup = chat.isGroup || contactById.get(chat.contactId)?.isGroup;
    if (mode === "only") {
      if (isGroup) visible.push(chat);
      else hiddenCount += 1;
      continue;
    }
    const keepGroup =
      mode === "unread"
        ? chat.unread > 0
        : mode === "pinned"
          ? Boolean(chat.pinned)
          : mode === "mentions"
            ? mentionedChatIds.has(chat.id)
            : false;
    if (isGroup && !keepGroup) {
      hiddenCount += 1;
    } else {
      visible.push(chat);
    }
  }
  return { chats: visible, hiddenCount };
}

export function countGroupChats(
  chats: ChatPreview[],
  contactById: ReadonlyMap<string, Contact>,
  mentionedChatIds: ReadonlySet<string>
): GroupChatCounts {
  const counts: GroupChatCounts = {
    all: 0,
    hidden: 0,
    only: 0,
    unread: 0,
    pinned: 0,
    mentions: 0,
  };
  for (const chat of chats) {
    if (!(chat.isGroup || contactById.get(chat.contactId)?.isGroup)) continue;
    counts.all += 1;
    counts.hidden += 1;
    counts.only += 1;
    if (chat.unread > 0) counts.unread += 1;
    if (chat.pinned) counts.pinned += 1;
    if (mentionedChatIds.has(chat.id)) counts.mentions += 1;
  }
  return counts;
}
