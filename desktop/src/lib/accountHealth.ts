/**
 * 账号发送健康度：优先用 outboundStats 滚动计数 O(1)；
 * 若传入 messages 且尚未 seed，会冷启动一次。
 */

import type { Message } from "@/types/crm";
import type { WaAccount } from "@/types/account";
import {
  getOutboundCounts,
  seedOutboundStatsFromMessages,
} from "@/lib/outboundStats";

export type HealthLevel = "green" | "yellow" | "red";

export type AccountHealth = {
  accountId: string;
  level: HealthLevel;
  score: number; // 0-100，高更好
  sentLastHour: number;
  sentLastDay: number;
  newChatsLastDay: number;
  caps: {
    perHour: number;
    perDaySoft: number;
  };
  hints: string[];
  summary: string;
};

export type RateCaps = {
  perPhonePerMinute?: number;
  perPhonePerHour?: number;
  minIntervalSec?: number;
};

type HealthTextKey =
  | "health.summaryGreen"
  | "health.summaryYellow"
  | "health.summaryRed"
  | "health.hintHourLimit"
  | "health.hintHourHigh"
  | "health.hintDayLimit"
  | "health.hintDayHigh"
  | "health.hintNewChatsHigh"
  | "health.hintNewChatsMany"
  | "health.hintNoOutbound";

export function localizeAccountHealth(
  health: AccountHealth,
  t: (key: HealthTextKey, params?: Record<string, string | number>) => string
): { summary: string; hints: string[] } {
  const params = {
    hour: health.sentLastHour,
    day: health.sentLastDay,
    hourCap: health.caps.perHour,
    dayCap: health.caps.perDaySoft,
    chats: health.newChatsLastDay,
  };
  const hints: string[] = [];
  const hourRatio = health.sentLastHour / health.caps.perHour;
  const dayRatio = health.sentLastDay / health.caps.perDaySoft;

  if (hourRatio >= 1) hints.push(t("health.hintHourLimit", params));
  else if (hourRatio >= 0.75) hints.push(t("health.hintHourHigh", params));
  if (dayRatio >= 1) hints.push(t("health.hintDayLimit", params));
  else if (dayRatio >= 0.7) hints.push(t("health.hintDayHigh", params));
  if (health.newChatsLastDay >= 40)
    hints.push(t("health.hintNewChatsHigh", params));
  else if (health.newChatsLastDay >= 25)
    hints.push(t("health.hintNewChatsMany", params));
  if (health.sentLastDay === 0) hints.push(t("health.hintNoOutbound"));

  const summaryKey =
    health.level === "green"
      ? "health.summaryGreen"
      : health.level === "yellow"
        ? "health.summaryYellow"
        : "health.summaryRed";
  return { summary: t(summaryKey, params), hints };
}

function scoreFromCounts(
  accountId: string,
  sentLastHour: number,
  sentLastDay: number,
  newChatsLastDay: number,
  perHour: number,
  perDaySoft: number
): AccountHealth {
  const hints: string[] = [];
  let score = 100;
  const hourRatio = sentLastHour / perHour;
  const dayRatio = sentLastDay / perDaySoft;

  if (hourRatio >= 1) {
    score -= 45;
    hints.push(
      `近 1 小时已发 ${sentLastHour} 条，达到/超过每小时建议上限 ${perHour}`
    );
  } else if (hourRatio >= 0.75) {
    score -= 25;
    hints.push(`近 1 小时发送偏多（${sentLastHour}/${perHour}）`);
  } else if (hourRatio >= 0.5) {
    score -= 10;
  }

  if (dayRatio >= 1) {
    score -= 30;
    hints.push(`近 24h 发送 ${sentLastDay} 条，建议放缓并穿插真实互动`);
  } else if (dayRatio >= 0.7) {
    score -= 15;
    hints.push(`近 24h 量偏高（${sentLastDay} 条）`);
  }

  if (newChatsLastDay >= 40) {
    score -= 20;
    hints.push(`近 24h 触及 ${newChatsLastDay} 个会话，新开聊偏猛`);
  } else if (newChatsLastDay >= 25) {
    score -= 10;
    hints.push(`新会话偏多（${newChatsLastDay}）`);
  }

  if (sentLastDay === 0) {
    hints.push("今日尚无出站，可正常经营");
  }

  score = Math.max(0, Math.min(100, score));
  let level: HealthLevel = "green";
  if (score < 45) level = "red";
  else if (score < 75) level = "yellow";

  const summary =
    level === "green"
      ? `状态良好 · 1h ${sentLastHour} 条 / 24h ${sentLastDay} 条`
      : level === "yellow"
        ? `需注意 · 1h ${sentLastHour} 条 / 24h ${sentLastDay} 条`
        : `高风险 · 1h ${sentLastHour} 条 / 24h ${sentLastDay} 条，建议冷却`;

  return {
    accountId,
    level,
    score,
    sentLastHour,
    sentLastDay,
    newChatsLastDay,
    caps: { perHour, perDaySoft },
    hints: hints.slice(0, 4),
    summary,
  };
}

export function computeAccountHealth(opts: {
  accountId: string;
  /** 可选：首次用于 seed 滚动窗口；之后可传 [] */
  messages?: Message[];
  caps?: RateCaps;
  now?: number;
}): AccountHealth {
  const now = opts.now ?? Date.now();
  const perHour = Math.max(1, opts.caps?.perPhonePerHour ?? 80);
  const perDaySoft = Math.max(perHour * 6, perHour);

  if (opts.messages && opts.messages.length) {
    seedOutboundStatsFromMessages(opts.messages);
  }

  const c = getOutboundCounts(opts.accountId, now);
  return scoreFromCounts(
    opts.accountId,
    c.sentLastHour,
    c.sentLastDay,
    c.newChatsLastDay,
    perHour,
    perDaySoft
  );
}

export function computeAllAccountsHealth(opts: {
  accounts: WaAccount[];
  messages?: Message[];
  caps?: RateCaps;
  now?: number;
}): AccountHealth[] {
  if (opts.messages && opts.messages.length) {
    seedOutboundStatsFromMessages(opts.messages);
  }
  return (opts.accounts || []).map((a) =>
    computeAccountHealth({
      accountId: a.id,
      // 已 seed，避免每个账号再扫
      messages: undefined,
      caps: opts.caps,
      now: opts.now,
    })
  );
}
