/**
 * 统一发送门闸：号暂停 → 过热 → 限速（含新号 warmup / jitter 记录侧）。
 * 文本走 dispatchSendText；媒体等调用 assertSendGate + recordOutboundSend。
 */

import type { Message } from "@/types/crm";
import { computeAccountHealth } from "@/lib/accountHealth";
import {
  applyAccountWarmup,
  createdAtForAccount,
} from "@/lib/accountWarmup";
import { noteOutboundSend, seedOutboundStatsFromMessages } from "@/lib/outboundStats";
import {
  checkRateLimit,
  DEFAULT_RATE_LIMITS,
  recordSend,
  type RateLimitKeyInput,
} from "./rateLimit";
import type { SendRateLimits } from "./types";

export type SendGateConfig = {
  /** false 时跳过分钟/小时/间隔限速，暂停与过热仍生效 */
  rateLimitEnabled?: boolean;
  rateLimits?: Partial<SendRateLimits>;
  /** 过热 red 拦截 */
  blockSendWhenOverheated?: boolean;
  /** 手动暂停的账号 id */
  sendPausedAccountIds?: string[];
  /** 最小间隔额外随机秒数（成功后写入） */
  rateJitterSec?: number;
  /** 跨账号成功发送最小间隔秒，0=关 */
  globalMinGapSec?: number;
  /** 算健康度用的出站消息（通常 store.messages） */
  messages?: Message[];
  /** 用于新号 72h warmup（createdAt） */
  waAccounts?: { id: string; createdAt?: string; warmupExempt?: boolean }[];
};

export type SendGateOk = {
  ok: true;
  /** 门闸实际使用的额度（可能已 warmup） */
  effectiveLimits: SendRateLimits;
  warmup: boolean;
  warmupLabel?: string;
};
export type SendGateBlock = {
  ok: false;
  error: "send_paused" | "overheated" | "rate_limited";
  reason: string;
  retryAfterMs?: number;
  /** 排队重试（限速）vs 失败（暂停/过热） */
  queueable: boolean;
};

// ponytail: one process-wide queue keeps check/send/record atomic; split per account only if throughput requires it.
let sendGateTail: Promise<void> = Promise.resolve();

/** @deprecated 滚动计数后无需短缓存；保留 API 兼容 */
export function invalidateAccountHealthCache(_accountId?: string | null) {
  /* no-op: outboundStats is live */
}

function healthForGate(
  accountId: string,
  messages: Message[] | undefined,
  limits: SendRateLimits
) {
  // 首次：用 messages 冷启动滚动窗口；之后 O(1)
  if (messages?.length) seedOutboundStatsFromMessages(messages);
  return computeAccountHealth({
    accountId,
    messages: undefined,
    caps: {
      perPhonePerHour: limits.perPhonePerHour,
      perPhonePerMinute: limits.perPhonePerMinute,
      minIntervalSec: limits.minIntervalSec,
    },
  });
}

export function resolveEffectiveLimits(
  config: SendGateConfig,
  accountId?: string | null
): {
  limits: SendRateLimits;
  warmup: boolean;
  warmupLabel?: string;
} {
  const base: SendRateLimits = {
    ...DEFAULT_RATE_LIMITS,
    ...config.rateLimits,
  };
  const created = createdAtForAccount(config.waAccounts, accountId);
  const w = applyAccountWarmup(base, created);
  return {
    limits: w.limits,
    warmup: w.active,
    warmupLabel: w.active ? w.factorLabel : undefined,
  };
}

export function assertSendGate(
  input: RateLimitKeyInput,
  config: SendGateConfig = {}
): SendGateOk | SendGateBlock {
  const accountId = (input.accountId || "").trim();
  const paused = config.sendPausedAccountIds || [];
  if (accountId && paused.includes(accountId)) {
    return {
      ok: false,
      error: "send_paused",
      reason: "该账号已在「监测」中暂停发送。恢复后再发，或换号。",
      queueable: false,
    };
  }

  const { limits, warmup, warmupLabel } = resolveEffectiveLimits(
    config,
    input.accountId
  );

  if (config.blockSendWhenOverheated !== false && accountId) {
    const h = healthForGate(accountId, config.messages, limits);
    if (h.level === "red") {
      return {
        ok: false,
        error: "overheated",
        reason: `发送过热已拦截：${h.summary}`,
        queueable: false,
        retryAfterMs: 15 * 60_000,
      };
    }
  }

  if (config.rateLimitEnabled !== false) {
    const rate = checkRateLimit(input.phoneE164 || "", input.deviceId, limits, {
      accountId: input.accountId,
    });
    if (!rate.ok) {
      const suffix = warmup && warmupLabel ? `（${warmupLabel}）` : "";
      return {
        ok: false,
        error: "rate_limited",
        reason: `${rate.reason}${suffix}`,
        retryAfterMs: rate.retryAfterMs,
        queueable: true,
      };
    }
  }

  return {
    ok: true,
    effectiveLimits: limits,
    warmup,
    warmupLabel,
  };
}

/** 发送成功后记账（文本 / 媒体共用） */
export function recordOutboundSend(
  input: RateLimitKeyInput,
  config: SendGateConfig = {},
  effectiveLimits?: SendRateLimits
) {
  const limits =
    effectiveLimits ||
    resolveEffectiveLimits(config, input.accountId).limits;
  recordSend(input.phoneE164 || "", input.deviceId, input.accountId, {
    minIntervalSec: limits.minIntervalSec,
    jitterSec: config.rateJitterSec ?? 2,
    globalMinGapSec: config.globalMinGapSec ?? 0,
  });
  noteOutboundSend({
    accountId: input.accountId,
    // chatId 未知时仅记条数；门闸层足够做 1h/24h 量
  });
}

/**
 * 统一「先门闸再发送再记账」。
 * 媒体 / 转发 / 任意 baileys 旁路应优先走此包装，避免漏 gate。
 */
export async function withSendGate<T>(
  input: RateLimitKeyInput,
  config: SendGateConfig,
  sendFn: () => Promise<T>
): Promise<
  | { ok: true; result: T; gate: SendGateOk }
  | { ok: false; gate: SendGateBlock; result?: undefined }
> {
  const previous = sendGateTail;
  let release!: () => void;
  sendGateTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    const gate = assertSendGate(input, config);
    if (!gate.ok) {
      return { ok: false, gate };
    }
    const result = await sendFn();
    const succeeded =
      result === undefined ||
      result === null ||
      (typeof result === "object" &&
        result !== null &&
        // 无 ok 字段视为成功（baileys 多数返回 raw）
        (!("ok" in (result as object)) ||
          (result as { ok?: boolean }).ok !== false) &&
        // Android 预览可能 ok=true 但 delivered=false，不能计入出站统计。
        (!("delivered" in (result as object)) ||
          (result as { delivered?: boolean }).delivered !== false));
    if (succeeded) {
      recordOutboundSend(input, config, gate.effectiveLimits);
    }
    return { ok: true, result, gate };
  } finally {
    release();
  }
}
