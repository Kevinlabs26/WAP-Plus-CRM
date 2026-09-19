/**
 * 发送通道抽象 — CRM 为主。
 *
 * - 默认主路径 = baileys（内嵌扫码，无需 Docker）
 * - android_bridge = 真机备用
 * - 不做 Cloud API / 不做 WAHA
 */

export type ChannelId = "baileys" | "android_bridge";

export const CHANNEL_META: Record<
  ChannelId,
  {
    label: string;
    shortLabel: string;
    description: string;
    /** 是否已实现可发送 */
    implemented: boolean;
    /** 是否主推防封路径 */
    primaryAntiBan: boolean;
    riskNote: string;
  }
> = {
  baileys: {
    label: "内嵌 Baileys（推荐）",
    shortLabel: "Baileys",
    description: "扫码连接 WhatsApp，后台同步并使用 WAP Plus 自定义界面。",
    implemented: true,
    primaryAntiBan: false,
    riskNote: "非 Meta 官方接口，请保持正常人工沟通频率。",
  },
  android_bridge: {
    label: "真机 Bridge（备用）",
    shortLabel: "真机",
    description:
      "经 Android 手机上的 WhatsApp Business 真实发出。贴近真人设备行为。",
    implemented: true,
    primaryAntiBan: true,
    riskNote: "仍需配合限速与正常使用；非无限防封。",
  },
};

export interface SendTextInput {
  text: string;
  phoneE164: string;
  displayName?: string;
  /** CRM 侧设备 id（真机通道使用） */
  deviceId?: string | null;
  contactId?: string | null;
  /** WhatsApp 账号槽：Baileys 多 session 路由 */
  accountId?: string | null;
  /** 协议级引用 */
  quoted?: {
    id: string;
    remoteJid?: string;
    fromMe?: boolean;
    participant?: string;
    body?: string;
  };
  /** 群 @ 提及 jid 列表（含 @所有人展开后的成员） */
  mentionedJid?: string[];
}

export interface SendTextResult {
  ok: boolean;
  /** 通道是否真正投递（非仅本地） */
  delivered: boolean;
  channel: ChannelId;
  /** local | queued | sent | failed | unsupported */
  status: "local" | "queued" | "sent" | "failed" | "unsupported";
  message: string;
  error?: string;
  raw?: unknown;
  /** 建议多久后重试（限速等） */
  retryAfterMs?: number;
}

export interface ChannelHealth {
  channel: ChannelId;
  ok: boolean;
  detail: string;
}

export interface MessageChannel {
  readonly id: ChannelId;
  health(): Promise<ChannelHealth>;
  sendText(input: SendTextInput): Promise<SendTextResult>;
}

/** 全局限速配置（行为层防封，与通道无关） */
export interface SendRateLimits {
  /** 每号码每分钟最多发送 */
  perPhonePerMinute: number;
  /** 每号码每小时最多发送 */
  perPhonePerHour: number;
  /** 两条消息最小间隔（秒） */
  minIntervalSec: number;
}
