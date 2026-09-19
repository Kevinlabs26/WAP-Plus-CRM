/**
 * 未回/超时自动跟进：规则定义（纯数据 + 纯判定，无 store）。
 */

export type FollowUpRuleId =
  | "inbound_no_reply"
  | "outbound_no_answer"
  | "quoting_stale";

export type FollowUpRule = {
  id: FollowUpRuleId;
  /** 展示名 */
  title: string;
  /** 超时小时 */
  afterHours: number;
  /** 不适用于这些阶段 */
  excludeStages?: string[];
  /** 生成的跟进备注模板；可用 {hours} */
  noteTemplate: string;
  /**
   * inbound_no_reply: 最后一条是客户来信且超时未再出站
   * outbound_no_answer: 最后一条是我方出站且超时无回
   * quoting_stale: 报价中阶段，任意方向最后消息超时
   */
  kind: FollowUpRuleId;
};

/** 默认规则：可后续接到 settings，此处保持单一来源 */
export const DEFAULT_FOLLOW_UP_RULES: FollowUpRule[] = [
  {
    id: "inbound_no_reply",
    title: "客户来信未回",
    afterHours: 4,
    excludeStages: ["won", "after_sales"],
    noteTemplate: "自动：客户来信已超 {hours}h 未回复",
    kind: "inbound_no_reply",
  },
  {
    id: "outbound_no_answer",
    title: "我方已发未回",
    afterHours: 24,
    excludeStages: ["won", "after_sales", "new"],
    noteTemplate: "自动：发出后超 {hours}h 客户未回复",
    kind: "outbound_no_answer",
  },
  {
    id: "quoting_stale",
    title: "报价沉默",
    afterHours: 48,
    excludeStages: ["won", "after_sales", "new", "contacted"],
    noteTemplate: "自动：报价阶段超 {hours}h 无新消息",
    kind: "quoting_stale",
  },
];

export type ThreadTip = {
  contactId: string;
  stage?: string;
  lastDirection?: "in" | "out";
  lastAt?: string; // ISO
  lastBody?: string;
};

export function hoursSince(iso: string | undefined, nowMs: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return (nowMs - t) / 3600_000;
}

export function ruleMatches(
  rule: FollowUpRule,
  tip: ThreadTip,
  nowMs: number
): boolean {
  if (tip.stage && rule.excludeStages?.includes(tip.stage)) return false;
  const h = hoursSince(tip.lastAt, nowMs);
  if (h == null || h < rule.afterHours) return false;

  if (rule.kind === "inbound_no_reply") {
    return tip.lastDirection === "in";
  }
  if (rule.kind === "outbound_no_answer") {
    return tip.lastDirection === "out";
  }
  if (rule.kind === "quoting_stale") {
    return tip.stage === "quoting";
  }
  return false;
}

export function formatRuleNote(rule: FollowUpRule): string {
  return rule.noteTemplate.replace(/\{hours\}/g, String(rule.afterHours));
}

/** 稳定 id，避免重复创建 */
export function autoFollowUpId(ruleId: string, contactId: string): string {
  return `auto-fu-${ruleId}-${contactId}`;
}

export function isAutoFollowUpId(id: string): boolean {
  return String(id || "").startsWith("auto-fu-");
}

/** 设置里可覆盖的规则项（精简存储） */
export type FollowUpRuleSetting = {
  id: FollowUpRuleId;
  enabled: boolean;
  afterHours: number;
};

export const DEFAULT_FOLLOW_UP_RULE_SETTINGS: FollowUpRuleSetting[] =
  DEFAULT_FOLLOW_UP_RULES.map((r) => ({
    id: r.id,
    enabled: true,
    afterHours: r.afterHours,
  }));

/**
 * 把用户设置合并进完整规则（关闭的规则不返回）。
 */
export function resolveFollowUpRules(
  settings?: FollowUpRuleSetting[] | null
): FollowUpRule[] {
  const byId = new Map(
    (settings || []).map((s) => [s.id, s] as const)
  );
  const out: FollowUpRule[] = [];
  for (const base of DEFAULT_FOLLOW_UP_RULES) {
    const s = byId.get(base.id);
    if (s && s.enabled === false) continue;
    const hours = Number(s?.afterHours);
    out.push({
      ...base,
      afterHours:
        Number.isFinite(hours) && hours > 0
          ? Math.min(168, Math.max(1, Math.round(hours)))
          : base.afterHours,
    });
  }
  return out;
}
