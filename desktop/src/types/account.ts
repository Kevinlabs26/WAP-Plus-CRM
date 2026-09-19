/**
 * WhatsApp 账号槽位（本地 CRM 视角）
 * - 一号一 session；消息/会话必须带 accountId
 * - 浏览范围（view）与发送身份（send）分离，见 store/accountScope.ts
 */

export type WaAccountStatus =
  | "disconnected"
  | "connecting"
  | "qr"
  | "connected"
  | "error";

export interface WaAccount {
  id: string;
  /** 侧栏展示名，可改 */
  label: string;
  /** 连接后的 WA 推送名 */
  userName?: string;
  /** 本机号 E.164（若可得） */
  phoneE164?: string;
  /** 本账号头像（Baileys profile pic，可能为 data URL） */
  avatarUrl?: string;
  status: WaAccountStatus;
  /** UI 角标色 token，如 brand/sky/violet */
  color?: string;
  /** 排序，小在前 */
  sort: number;
  createdAt: string;
  updatedAt: string;
  lastSyncAt?: string;
  /** 用户确认该 WhatsApp 账号并非新号时，跳过本机 72h 新号保护 */
  warmupExempt?: boolean;
}

/** 会话列表浏览范围 */
export type AccountViewMode =
  | { type: "all" }
  | { type: "account"; accountId: string };

/** 分组作用域：号内 或 全部视图跨号 */
export type FolderScope =
  | { type: "account"; accountId: string }
  | { type: "all" };

export const DEFAULT_ACCOUNT_ID = "wa-default";
