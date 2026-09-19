import type { SendRateLimits } from "@/channels/types";

/** 新号保护窗口：建档起 72 小时 */
export const ACCOUNT_WARMUP_MS = 72 * 3600_000;

export type WarmupResult = {
  limits: SendRateLimits;
  active: boolean;
  /** 剩余小时（向上取整） */
  hoursLeft: number;
  factorLabel: string;
};

/**
 * 新号降额：分钟/小时上限下调，最小间隔拉长。
 * 无 createdAt 或已过窗口 → 原样返回。
 */
export function applyAccountWarmup(
  limits: SendRateLimits,
  createdAt?: string | null,
  now = Date.now()
): WarmupResult {
  const t = createdAt ? Date.parse(createdAt) : NaN;
  if (!Number.isFinite(t) || t <= 0) {
    return { limits, active: false, hoursLeft: 0, factorLabel: "" };
  }
  const age = now - t;
  if (age < 0 || age >= ACCOUNT_WARMUP_MS) {
    return { limits, active: false, hoursLeft: 0, factorLabel: "" };
  }
  const hoursLeft = Math.max(1, Math.ceil((ACCOUNT_WARMUP_MS - age) / 3600_000));
  const warmed: SendRateLimits = {
    perPhonePerMinute: Math.max(2, Math.floor(limits.perPhonePerMinute * 0.4)),
    perPhonePerHour: Math.max(12, Math.floor(limits.perPhonePerHour * 0.35)),
    minIntervalSec: Math.max(
      limits.minIntervalSec + 3,
      Math.ceil(limits.minIntervalSec * 1.6)
    ),
  };
  return {
    limits: warmed,
    active: true,
    hoursLeft,
    factorLabel: `新号保护 · 约 ${hoursLeft}h 内降额`,
  };
}

export function createdAtForAccount(
  accounts:
    | { id: string; createdAt?: string; warmupExempt?: boolean }[]
    | undefined,
  accountId?: string | null
): string | undefined {
  const id = (accountId || "").trim();
  if (!id || !accounts?.length) return undefined;
  const account = accounts.find((a) => a.id === id);
  return account?.warmupExempt ? undefined : account?.createdAt;
}
