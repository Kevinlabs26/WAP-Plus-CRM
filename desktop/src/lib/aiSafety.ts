export const MANUAL_TAKEOVER_WINDOW_MS = 30 * 60 * 1000;

export interface AiAutoReplyPolicy {
  /** 本地时间 HH:mm；任一留空表示全天 */
  activeStart: string;
  activeEnd: string;
  takeoverMinutes: number;
  allowPricing: boolean;
}

export const DEFAULT_AUTO_REPLY_POLICY: AiAutoReplyPolicy = {
  activeStart: "",
  activeEnd: "",
  takeoverMinutes: MANUAL_TAKEOVER_WINDOW_MS / 60_000,
  allowPricing: false,
};

export interface AutoReplySafetyMessage {
  id?: string;
  direction: "in" | "out";
  body?: string;
  sentAt: string;
  systemKind?: string;
}

export interface AutoReplyReplayMessage extends AutoReplySafetyMessage {
  id: string;
  chatId: string;
  body: string;
}

export type AutoReplyDecision =
  | { allow: true; kind: "reply"; reason: string }
  | {
      allow: false;
      kind: "manual_takeover" | "outside_hours" | "risk";
      reason: string;
      takeoverKey?: string;
    };

type AutoReplyRiskCategory =
  | "empty"
  | "sensitive"
  | "financial"
  | "pricing"
  | "complaint";

interface AutoReplyRisk {
  category: AutoReplyRiskCategory;
  reason: string;
}

function normalizeTime(value: unknown): string {
  const time = typeof value === "string" ? value.trim() : "";
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : "";
}

export function normalizeAutoReplyPolicy(
  raw: unknown,
  fallback: AiAutoReplyPolicy = DEFAULT_AUTO_REPLY_POLICY
): AiAutoReplyPolicy {
  const source = raw && typeof raw === "object" ? raw as Partial<AiAutoReplyPolicy> : {};
  const minutes = Number(source.takeoverMinutes ?? fallback.takeoverMinutes);
  return {
    activeStart: normalizeTime(source.activeStart ?? fallback.activeStart),
    activeEnd: normalizeTime(source.activeEnd ?? fallback.activeEnd),
    takeoverMinutes: Number.isFinite(minutes)
      ? Math.min(1440, Math.max(1, Math.round(minutes)))
      : fallback.takeoverMinutes,
    allowPricing:
      typeof source.allowPricing === "boolean"
        ? source.allowPricing
        : fallback.allowPricing,
  };
}

export function resolveAutoReplyPolicy(
  defaultPolicy: unknown,
  byAccountId: unknown,
  accountId?: string
): AiAutoReplyPolicy {
  const base = normalizeAutoReplyPolicy(defaultPolicy);
  const id = String(accountId || "").trim();
  if (!id || !byAccountId || typeof byAccountId !== "object") return base;
  const override = (byAccountId as Record<string, unknown>)[id];
  return override ? normalizeAutoReplyPolicy(override, base) : base;
}

export function isWithinAutoReplyHours(
  policy: AiAutoReplyPolicy,
  now = new Date()
): boolean {
  const start = normalizeTime(policy.activeStart);
  const end = normalizeTime(policy.activeEnd);
  if (!start || !end || start === end) return true;
  const toMinutes = (value: string) => {
    const [hour, minute] = value.split(":").map(Number);
    return hour * 60 + minute;
  };
  const current = now.getHours() * 60 + now.getMinutes();
  const startMinutes = toMinutes(start);
  const endMinutes = toMinutes(end);
  return startMinutes < endMinutes
    ? current >= startMinutes && current < endMinutes
    : current >= startMinutes || current < endMinutes;
}

function getAutoReplyRisk(text: string): AutoReplyRisk | null {
  const value = text.trim();
  if (!value) return { category: "empty", reason: "消息为空" };

  if (
    /(验证码|一次性密码|密码|口令|token|otp|verification\s*code|password|credit\s*card|银行卡|信用卡)/i.test(
      value
    )
  ) {
    return { category: "sensitive", reason: "涉及账号或支付敏感信息" };
  }
  if (
    /(退款|退货|付款|支付|转账|发票|合同|法律|律师|起诉|refund|return|payment|pay|transfer|invoice|contract|legal|lawyer|lawsuit)/i.test(
      value
    )
  ) {
    return { category: "financial", reason: "涉及付款、合同或法律事项" };
  }
  if (
    /(价格|多少钱|报价|费用|折扣|price|quote|cost|how\s*much|discount)/i.test(
      value
    )
  ) {
    return { category: "pricing", reason: "涉及价格或商业承诺" };
  }
  if (
    /(投诉|举报|骗子|诈骗|欺诈|生气|不满|complaint|scam|fraud|angry)/i.test(
      value
    )
  ) {
    return { category: "complaint", reason: "涉及投诉或高情绪风险" };
  }
  return null;
}

/**
 * 自动回复只处理低风险闲聊；这些主题交给人工，避免 AI 代替用户作出承诺。
 */
export function getAutoReplyBlockReason(text: string): string | null {
  return getAutoReplyRisk(text)?.reason || null;
}

export function getAutoReplyOutputBlockReason(
  text: string,
  options?: { allowPricing?: boolean }
): string | null {
  const risk = getAutoReplyRisk(text);
  if (risk && !(risk.category === "pricing" && options?.allowPricing)) {
    return `AI 回复${risk.reason}`;
  }
  if (
    /(保证|承诺|一定能|肯定能|百分之百|已经安排|已确认|马上退款|按时送达|\b(?:i|we)\s+(?:guarantee|promise|confirm that|will refund|will arrive|have already arranged)\b|100%|\bdefinitely\b)/i.test(
      text
    )
  ) {
    return "AI 回复包含未经确认的承诺";
  }
  return null;
}

export function latestMessagesPerChat<
  T extends { chatId?: string; sentAt: string },
>(messages: readonly T[]): T[] {
  const latest = new Map<string, T>();
  for (const message of messages) {
    if (!message.chatId) continue;
    const previous = latest.get(message.chatId);
    if (!previous || message.sentAt >= previous.sentAt) {
      latest.set(message.chatId, message);
    }
  }
  return [...latest.values()];
}

export function getRecentManualTakeover(
  thread: readonly AutoReplySafetyMessage[],
  inbound: AutoReplySafetyMessage,
  now = Date.now(),
  windowMs = MANUAL_TAKEOVER_WINDOW_MS
): AutoReplySafetyMessage | null {
  const previousInbound = [...thread]
    .reverse()
    .find((message) => message.direction === "in" && message.sentAt < inbound.sentAt);
  const manual = [...thread]
    .reverse()
    .find(
      (message) =>
        message.direction === "out" &&
        !message.systemKind &&
        message.sentAt < inbound.sentAt &&
        (!previousInbound || message.sentAt > previousInbound.sentAt)
    );
  if (!manual) return null;
  const sentAt = Date.parse(manual.sentAt);
  if (!Number.isFinite(sentAt) || now - sentAt >= windowMs) {
    return null;
  }
  return manual;
}

export function evaluateAutoReplyDecision(
  thread: readonly AutoReplySafetyMessage[],
  inbound: AutoReplySafetyMessage,
  now = Date.now(),
  rawPolicy: unknown = DEFAULT_AUTO_REPLY_POLICY
): AutoReplyDecision {
  const policy = normalizeAutoReplyPolicy(rawPolicy);
  if (!isWithinAutoReplyHours(policy, new Date(now))) {
    return {
      allow: false,
      kind: "outside_hours",
      reason: `当前不在自动回复生效时段（${policy.activeStart}–${policy.activeEnd}）`,
    };
  }
  const takeoverWindowMs = policy.takeoverMinutes * 60_000;
  const takeover = getRecentManualTakeover(thread, inbound, now, takeoverWindowMs);
  if (takeover) {
    return {
      allow: false,
      kind: "manual_takeover",
      reason: `检测到手动回复，暂停自动回复 ${policy.takeoverMinutes} 分钟`,
      takeoverKey: takeover.id || takeover.sentAt,
    };
  }
  const risk = getAutoReplyRisk(inbound.body || "");
  if (risk && !(risk.category === "pricing" && policy.allowPricing)) {
    return { allow: false, kind: "risk", reason: risk.reason };
  }
  return { allow: true, kind: "reply", reason: "低风险消息，可以自动回复" };
}

export function parseAutoReplyReplay(
  raw: string,
  now = Date.now()
): AutoReplyReplayMessage[] {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-14);
  const messages: AutoReplyReplayMessage[] = [];
  for (const [index, line] of lines.entries()) {
    const mine = line.match(/^(?:我|me)\s*[:：]\s*(.*)$/i);
    const ai = line.match(/^(?:ai|助手)\s*[:：]\s*(.*)$/i);
    const theirs = line.match(/^(?:对方|客户|customer|them)\s*[:：]\s*(.*)$/i);
    const body = (mine?.[1] ?? ai?.[1] ?? theirs?.[1] ?? line).trim();
    if (!body) continue;
    messages.push({
      id: `ai-replay-${index}`,
      chatId: "ai-replay-chat",
      direction: mine || ai ? "out" : "in",
      body,
      sentAt: new Date(now - (lines.length - index) * 60_000).toISOString(),
      ...(ai ? { systemKind: "ai_auto_reply" } : {}),
    });
  }
  return messages;
}
