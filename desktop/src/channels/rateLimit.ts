/**
 * 发送限速 — 行为层保护，与 Bridge/API 通道无关。
 * 键优先 WhatsApp accountId；兼容器侧 device + 对方号码。
 * 状态写入 localStorage，刷新后短窗口仍生效。
 */

import type { SendRateLimits } from "./types";

export const DEFAULT_RATE_LIMITS: SendRateLimits = {
  perPhonePerMinute: 8,
  perPhonePerHour: 80,
  minIntervalSec: 4,
};

const STORAGE_KEY = "bridgecrm.rateLimit.v1";

type Stamp = number;

const byKey: Map<string, Stamp[]> = new Map();
/** 该键下次允许发送的时间戳（含发送成功后写入的 jitter） */
const nextAllowedAt: Map<string, Stamp> = new Map();
/** 本机任意账号下次允许（跨号总闸） */
let globalNextAllowedAt = 0;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let hydrated = false;

export type RateLimitKeyInput = {
  accountId?: string | null;
  phoneE164?: string | null;
  deviceId?: string | null;
};

function keyOf(input: RateLimitKeyInput): string {
  const aid = (input.accountId || "").trim();
  if (aid) return `acct::${aid}`;
  return `dev::${input.deviceId || "default"}::${input.phoneE164 || "unknown"}`;
}

function canUseStorage(): boolean {
  try {
    return typeof localStorage !== "undefined";
  } catch {
    return false;
  }
}

function hydrateFromStorage() {
  if (hydrated) return;
  hydrated = true;
  if (!canUseStorage()) return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw) as {
      v?: number;
      globalNextAllowedAt?: number;
      keys?: Record<string, { stamps?: number[]; nextAllowedAt?: number }>;
    };
    if (data.v !== 1 || !data.keys) return;
    const now = Date.now();
    if (typeof data.globalNextAllowedAt === "number" && data.globalNextAllowedAt > now) {
      globalNextAllowedAt = data.globalNextAllowedAt;
    }
    for (const [k, row] of Object.entries(data.keys)) {
      const stamps = (row.stamps || []).filter(
        (t) => typeof t === "number" && now - t < 3600_000
      );
      if (stamps.length) byKey.set(k, stamps);
      if (typeof row.nextAllowedAt === "number" && row.nextAllowedAt > now) {
        nextAllowedAt.set(k, row.nextAllowedAt);
      }
    }
  } catch {
    /* ignore corrupt */
  }
}

function schedulePersist() {
  if (!canUseStorage()) return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      const now = Date.now();
      const keys: Record<string, { stamps: number[]; nextAllowedAt: number }> =
        {};
      const idSet = new Set<string>([...byKey.keys(), ...nextAllowedAt.keys()]);
      for (const k of idSet) {
        const stamps = (byKey.get(k) || []).filter((t) => now - t < 3600_000);
        const nextAt = nextAllowedAt.get(k) || 0;
        if (!stamps.length && nextAt <= now) {
          byKey.delete(k);
          nextAllowedAt.delete(k);
          continue;
        }
        if (stamps.length) byKey.set(k, stamps);
        keys[k] = {
          stamps,
          nextAllowedAt: nextAt > now ? nextAt : 0,
        };
      }
      const payload = {
        v: 1 as const,
        globalNextAllowedAt:
          globalNextAllowedAt > now ? globalNextAllowedAt : 0,
        keys,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      /* quota / private mode */
    }
  }, 400);
}

/** 测试或设置页可手动清空 */
export function clearRateLimitState() {
  byKey.clear();
  nextAllowedAt.clear();
  globalNextAllowedAt = 0;
  if (canUseStorage()) {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
}

export function checkRateLimit(
  phoneE164: string,
  deviceId: string | null | undefined,
  limits: SendRateLimits = DEFAULT_RATE_LIMITS,
  opts?: {
    accountId?: string | null;
  }
): { ok: true } | { ok: false; reason: string; retryAfterMs?: number } {
  hydrateFromStorage();
  const key = keyOf({
    accountId: opts?.accountId,
    phoneE164,
    deviceId,
  });
  const now = Date.now();

  if (globalNextAllowedAt > now) {
    const retryAfterMs = globalNextAllowedAt - now;
    const wait = Math.ceil(retryAfterMs / 1000);
    return {
      ok: false,
      reason: `多号全局冷却中，请 ${wait}s 后再发（避免多号齐射）`,
      retryAfterMs,
    };
  }

  const nextAt = nextAllowedAt.get(key) ?? 0;
  if (nextAt > now) {
    const retryAfterMs = nextAt - now;
    const wait = Math.ceil(retryAfterMs / 1000);
    return {
      ok: false,
      reason: `发送过快，请 ${wait}s 后再试（最小间隔 ${limits.minIntervalSec}s + 节奏抖动）`,
      retryAfterMs,
    };
  }

  const stamps = (byKey.get(key) ?? []).filter((t) => now - t < 3600_000);
  const min1 = stamps.filter((t) => now - t < 60_000).length;
  if (min1 >= limits.perPhonePerMinute) {
    const oldestInWindow = stamps
      .filter((t) => now - t < 60_000)
      .sort((a, b) => a - b)[0];
    const retryAfterMs = oldestInWindow
      ? Math.max(1000, 60_000 - (now - oldestInWindow) + 200)
      : 15_000;
    return {
      ok: false,
      reason: `已达每分钟上限（${limits.perPhonePerMinute} 条/分钟）`,
      retryAfterMs,
    };
  }
  if (stamps.length >= limits.perPhonePerHour) {
    const oldest = [...stamps].sort((a, b) => a - b)[0];
    const retryAfterMs = oldest
      ? Math.max(5000, 3600_000 - (now - oldest) + 200)
      : 60_000;
    return {
      ok: false,
      reason: `已达每小时上限（${limits.perPhonePerHour} 条/小时）`,
      retryAfterMs,
    };
  }
  return { ok: true };
}

export function recordSend(
  phoneE164: string,
  deviceId?: string | null,
  accountId?: string | null,
  opts?: {
    minIntervalSec?: number;
    jitterSec?: number;
    globalMinGapSec?: number;
  }
) {
  hydrateFromStorage();
  const key = keyOf({ accountId, phoneE164, deviceId });
  const now = Date.now();
  const minSec = Math.max(
    0,
    opts?.minIntervalSec ?? DEFAULT_RATE_LIMITS.minIntervalSec
  );
  const jitter = Math.max(0, opts?.jitterSec ?? 0);
  const gapMs = (minSec + Math.random() * jitter) * 1000;
  nextAllowedAt.set(key, now + gapMs);

  const gSec = Math.max(0, opts?.globalMinGapSec ?? 0);
  if (gSec > 0) {
    const gJitter = Math.random() * Math.min(1.5, gSec);
    globalNextAllowedAt = Math.max(
      globalNextAllowedAt,
      now + (gSec + gJitter) * 1000
    );
  }

  const stamps = (byKey.get(key) ?? []).filter((t) => now - t < 3600_000);
  stamps.push(now);
  byKey.set(key, stamps);
  schedulePersist();
}

export function rateLimitSnapshot(
  phoneE164: string,
  deviceId?: string | null,
  limits: SendRateLimits = DEFAULT_RATE_LIMITS,
  accountId?: string | null
) {
  hydrateFromStorage();
  const key = keyOf({ accountId, phoneE164, deviceId });
  const now = Date.now();
  const stamps = (byKey.get(key) ?? []).filter((t) => now - t < 3600_000);
  return {
    lastMinute: stamps.filter((t) => now - t < 60_000).length,
    lastHour: stamps.length,
    limits,
    nextAllowedInMs: Math.max(0, (nextAllowedAt.get(key) ?? 0) - now),
  };
}
