import { androidBridgeChannel } from "./androidBridge";
import { baileysChannel } from "./baileys";
import {
  CHANNEL_META,
  type ChannelId,
  type MessageChannel,
  type SendRateLimits,
  type SendTextInput,
  type SendTextResult,
} from "./types";
import { DEFAULT_RATE_LIMITS } from "./rateLimit";
import {
  withSendGate,
  type SendGateConfig,
} from "./sendGate";
import type { Message } from "@/types/crm";

export * from "./types";
export {
  DEFAULT_RATE_LIMITS,
  rateLimitSnapshot,
  clearRateLimitState,
} from "./rateLimit";
export {
  assertSendGate,
  recordOutboundSend,
  resolveEffectiveLimits,
  withSendGate,
  invalidateAccountHealthCache,
} from "./sendGate";
export type { SendGateConfig } from "./sendGate";

export interface ChannelRuntimeConfig {
  channelId: ChannelId | string;
  rateLimitEnabled?: boolean;
  rateLimits?: Partial<SendRateLimits>;
  blockSendWhenOverheated?: boolean;
  sendPausedAccountIds?: string[];
  rateJitterSec?: number;
  globalMinGapSec?: number;
  /** 过热计算依赖；不传则跳过过热门闸（不推荐） */
  messages?: Message[];
  /** 新号 warmup */
  waAccounts?: { id: string; createdAt?: string; warmupExempt?: boolean }[];
}

/** 仅 baileys | android_bridge；历史 waha / cloud_api 等一律 → baileys */
export function normalizeChannelId(id: unknown): ChannelId {
  if (id === "android_bridge") return "android_bridge";
  return "baileys";
}

export function getChannel(config: ChannelRuntimeConfig): MessageChannel {
  switch (normalizeChannelId(config.channelId)) {
    case "android_bridge":
      return androidBridgeChannel;
    case "baileys":
    default:
      return baileysChannel;
  }
}

export function gateConfigFromRuntime(
  config: ChannelRuntimeConfig
): SendGateConfig {
  return {
    rateLimitEnabled: config.rateLimitEnabled,
    rateLimits: config.rateLimits,
    blockSendWhenOverheated: config.blockSendWhenOverheated,
    sendPausedAccountIds: config.sendPausedAccountIds,
    rateJitterSec: config.rateJitterSec,
    globalMinGapSec: config.globalMinGapSec,
    messages: config.messages,
    waAccounts: config.waAccounts,
  };
}

/**
 * 统一发送入口：门闸（暂停/过热/限速/warmup）→ 通道 sendText。
 * CRM UI 只应调用此函数，不要直接 bridgeInvoke 发消息。
 */
export async function dispatchSendText(
  input: SendTextInput,
  config: ChannelRuntimeConfig
): Promise<SendTextResult> {
  const channelId = normalizeChannelId(config.channelId);
  const meta = CHANNEL_META[channelId];

  if (!meta.implemented) {
    const ch = getChannel({ ...config, channelId });
    return ch.sendText(input);
  }

  const gateCfg = gateConfigFromRuntime(config);
  const channel = getChannel({ ...config, channelId });
  const outcome = await withSendGate(
    {
      accountId: input.accountId,
      phoneE164: input.phoneE164,
      deviceId: input.deviceId,
    },
    gateCfg,
    () => channel.sendText(input)
  );

  if (!outcome.ok) {
    return {
      ok: false,
      delivered: false,
      channel: channelId,
      status: outcome.gate.queueable ? "queued" : "failed",
      message: outcome.gate.reason,
      error: outcome.gate.error,
      retryAfterMs: outcome.gate.retryAfterMs,
    };
  }
  return outcome.result;
}

export function channelLabel(id: ChannelId | string): string {
  return CHANNEL_META[normalizeChannelId(id)]?.label ?? String(id);
}

/** 从 settings 切片拼运行时门闸（供 ChatPanel / 队列 / 媒体复用） */
export function sendRuntimeFromSettings(
  settings: {
    sendChannel?: string;
    rateLimitEnabled?: boolean;
    ratePerMinute?: number;
    ratePerHour?: number;
    rateMinIntervalSec?: number;
    blockSendWhenOverheated?: boolean;
    sendPausedAccountIds?: string[];
    rateJitterSec?: number;
    globalMinGapSec?: number;
    waAccounts?: { id: string; createdAt?: string; warmupExempt?: boolean }[];
  },
  messages?: Message[]
): ChannelRuntimeConfig {
  return {
    channelId: settings.sendChannel || "baileys",
    rateLimitEnabled: settings.rateLimitEnabled !== false,
    rateLimits: {
      ...DEFAULT_RATE_LIMITS,
      perPhonePerMinute:
        settings.ratePerMinute ?? DEFAULT_RATE_LIMITS.perPhonePerMinute,
      perPhonePerHour:
        settings.ratePerHour ?? DEFAULT_RATE_LIMITS.perPhonePerHour,
      minIntervalSec:
        settings.rateMinIntervalSec ?? DEFAULT_RATE_LIMITS.minIntervalSec,
    },
    blockSendWhenOverheated: settings.blockSendWhenOverheated !== false,
    sendPausedAccountIds: settings.sendPausedAccountIds || [],
    rateJitterSec: settings.rateJitterSec ?? 2,
    globalMinGapSec: settings.globalMinGapSec ?? 2,
    messages,
    waAccounts: settings.waAccounts,
  };
}
