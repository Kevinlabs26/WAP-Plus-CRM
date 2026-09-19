/**
 * 实时入站消息 → 桌面系统通知（点击跳会话）。
 * 静音会话 / 当前已打开且窗口前台 时不打扰。
 */
import { showDesktopNotify } from "@/lib/desktopNotify";

export type InboundNotifyItem = {
  messageId: string;
  chatId: string;
  contactId?: string;
  contactName: string;
  senderName?: string;
  avatarUrl?: string;
  unreadCount?: number;
  body: string;
  accountId?: string;
  isGroup?: boolean;
};

type Handlers = {
  /** 当前打开的会话 */
  selectedChatId: string | null;
  /** chatId → mutedUntil */
  mutedUntilByChatId: Record<string, number | null | undefined>;
  /** 总开关 */
  enabled: boolean;
  /** 群组消息是否单独弹系统通知 */
  groupMessagesEnabled: boolean;
  openChat: (opts: {
    chatId: string;
    contactId?: string;
    messageId?: string;
    accountId?: string;
  }) => void;
};

const recent = new Map<string, number>();
const DEDUPE_MS = 90_000;

export function previewBody(raw: string): string {
  const t = (raw || "").replace(/\s+/g, " ").trim();
  if (!t) return "发来一条消息";
  return t.length > 120 ? `${t.slice(0, 120)}…` : t;
}

export function notifyInboundMessages(
  items: InboundNotifyItem[],
  handlers: Handlers
): void {
  if (!handlers.enabled || !items.length) return;
  if (typeof document === "undefined") return;

  const now = Date.now();
  for (const [k, t] of recent) {
    if (now - t > DEDUPE_MS) recent.delete(k);
  }

  const windowFocused =
    typeof document.hasFocus === "function" ? document.hasFocus() : true;

  const pending = new Map<string, InboundNotifyItem[]>();
  for (const it of items) {
    if (!it.chatId || !it.messageId) continue;
    if (it.isGroup && !handlers.groupMessagesEnabled) continue;
    const mutedUntil = handlers.mutedUntilByChatId[it.chatId];
    if (typeof mutedUntil === "number" && mutedUntil > now) continue;
    // 已在看该会话且窗口前台：不弹
    if (
      handlers.selectedChatId === it.chatId &&
      windowFocused &&
      !document.hidden
    ) {
      continue;
    }
    const key = `${it.accountId || ""}|${it.messageId}`;
    if (recent.has(key)) continue;
    recent.set(key, now);

    const keyForChat = `${it.accountId || ""}|${it.chatId}`;
    const grouped = pending.get(keyForChat) || [];
    grouped.push(it);
    pending.set(keyForChat, grouped);
  }

  for (const grouped of pending.values()) {
    const it = grouped[grouped.length - 1]!;
    const baseTitle = it.isGroup
      ? it.contactName || "群聊"
      : it.contactName || "新消息";
    const title =
      grouped.length > 1 ? `${baseTitle} · ${grouped.length} 条新消息` : baseTitle;
    const preview = previewBody(it.body);
    const body =
      it.isGroup && it.senderName ? `${it.senderName}：${preview}` : preview;
    const onClick = () => {
      handlers.openChat({
        chatId: it.chatId,
        contactId: it.contactId,
        messageId: it.messageId,
        accountId: it.accountId,
      });
    };

    void showDesktopNotify({
      title,
      body,
      tag: `msg-${it.chatId}`,
      onClick,
      avatarUrl: it.avatarUrl,
      unreadCount: Math.max(it.unreadCount || 0, grouped.length),
    });
  }
}
