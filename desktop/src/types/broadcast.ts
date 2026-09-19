/** 克制版群发战役（本机，非 Cloud API） */

export type BroadcastCampaignStatus =
  | "draft"
  | "running"
  | "paused"
  | "cancelled"
  | "done";

export type BroadcastItemStatus =
  | "pending"
  | "sending"
  | "sent"
  | "failed"
  | "skipped";

export interface BroadcastItem {
  id: string;
  contactId: string;
  contactName: string;
  phoneE164: string;
  /** 已替换变量后的正文（开跑时冻结）；作为媒体 caption 或纯文本正文 */
  bodyRendered: string;
  status: BroadcastItemStatus;
  error?: string;
  sentAt?: string;
  /** 本地出站消息 id */
  messageId?: string;
}

export type BroadcastMediaKind = "image" | "video" | "audio" | "document";

/** 媒体分配模式 */
export type BroadcastMediaMode = "single" | "random" | "roundrobin";

export interface BroadcastMedia {
  id: string;
  kind: BroadcastMediaKind;
  mime: string;
  fileName?: string;
}

export interface BroadcastCampaign {
  id: string;
  accountId: string;
  title?: string;
  /** 原始模板，含 {name} {company}；渲染后作为纯文本正文或媒体 caption */
  template: string;
  /** 可选媒体池（大小限制内）；发送时按 mediaMode 分配 */
  media?: BroadcastMedia[];
  mediaMode?: BroadcastMediaMode;
  status: BroadcastCampaignStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  /** 战役随机间隔下限（秒），叠在全局门闸之上 */
  extraGapSec: number;
  /** 战役随机间隔上限（秒） */
  extraGapMaxSec: number;
  items: BroadcastItem[];
}

/** 单次战役人数硬顶 */
export const BROADCAST_HARD_CAP = 50;
/** 默认随机间隔 20–30 秒 */
export const BROADCAST_DEFAULT_EXTRA_GAP_SEC = 20;
export const BROADCAST_DEFAULT_EXTRA_GAP_MAX_SEC = 30;
/** 保留最近战役条数 */
export const BROADCAST_HISTORY_MAX = 30;
