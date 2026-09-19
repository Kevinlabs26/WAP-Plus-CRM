/**
 * 多账号浏览/发送范围 — 纯函数，不进巨型 appStore
 */
import type { AccountViewMode } from "@/types/account";
import type { ChatPreview, Contact } from "@/types/crm";
import { DEFAULT_ACCOUNT_ID } from "@/types/account";

export function resolveEntityAccountId(
  accountId?: string | null,
  fallback = DEFAULT_ACCOUNT_ID
): string {
  const id = (accountId || "").trim();
  return id || fallback;
}

/**
 * 单 session 下：直播号与历史 wa-default 视为同一数据域，
 * 避免「主账号有列表、E 在线为空」。
 */
export function accountIdsInSameBucket(
  viewAccountId: string,
  liveAccountId?: string | null
): Set<string> {
  const set = new Set<string>();
  const view = (viewAccountId || "").trim() || DEFAULT_ACCOUNT_ID;
  const live = (liveAccountId || "").trim();
  set.add(view);
  // 仅当「正在看直播号/默认槽」时，兼容旧 wa-default 数据
  // 看其它空槽时绝不能混入 E 的会话
  const viewingLive = !live || view === live || view === DEFAULT_ACCOUNT_ID;
  if (viewingLive) {
    if (live) set.add(live);
    set.add(DEFAULT_ACCOUNT_ID);
  }
  return set;
}

export function contactInView(
  contact: Contact,
  view: AccountViewMode,
  fallbackAccountId = DEFAULT_ACCOUNT_ID,
  liveAccountId?: string | null
): boolean {
  if (view.type === "all") return true;
  const owner = resolveEntityAccountId(contact.accountId, fallbackAccountId);
  const bucket = accountIdsInSameBucket(view.accountId, liveAccountId || fallbackAccountId);
  return bucket.has(owner);
}

export function chatInView(
  chat: ChatPreview,
  view: AccountViewMode,
  fallbackAccountId = DEFAULT_ACCOUNT_ID,
  liveAccountId?: string | null
): boolean {
  if (view.type === "all") return true;
  // accountId 优先；旧数据常用 phoneId 存 wa 槽
  const owner = resolveEntityAccountId(
    chat.accountId || chat.phoneId,
    fallbackAccountId
  );
  const bucket = accountIdsInSameBucket(
    view.accountId,
    liveAccountId || fallbackAccountId
  );
  return bucket.has(owner);
}

/** 发送身份：默认跟随会话归属账号 */
export function resolveSendAccountId(opts: {
  chatAccountId?: string | null;
  activeAccountId: string;
  lockSendToActive?: boolean;
}): string {
  if (opts.lockSendToActive) return opts.activeAccountId;
  return resolveEntityAccountId(opts.chatAccountId, opts.activeAccountId);
}
