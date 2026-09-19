/**
 * 根据消息/联系人状态生成自动跟进（纯函数）。
 * 由 appStore 在同步后调用并写入。
 */
import {
  DEFAULT_FOLLOW_UP_RULES,
  autoFollowUpId,
  formatRuleNote,
  isAutoFollowUpId,
  ruleMatches,
  type FollowUpRule,
  type ThreadTip,
} from "@/lib/followUpRules";
import type { Contact, FollowUp, Message } from "@/types/crm";

export type FollowUpAutomationResult = {
  followUps: FollowUp[];
  contacts: Contact[];
  /** 新创建的自动跟进（用于 toast，宜节流） */
  created: FollowUp[];
};

function buildTips(
  contacts: Contact[],
  messages: Message[],
  limitContacts = 400
): ThreadTip[] {
  // 每个 contact 最后一条消息
  const lastByContact = new Map<string, Message>();
  for (const m of messages) {
    const cid = m.contactId;
    if (!cid) continue;
    const prev = lastByContact.get(cid);
    if (!prev || m.sentAt >= prev.sentAt) lastByContact.set(cid, m);
  }

  const tips: ThreadTip[] = [];
  let n = 0;
  for (const c of contacts) {
    if (c.isGroup) continue;
    const last = lastByContact.get(c.id);
    if (!last) continue;
    tips.push({
      contactId: c.id,
      stage: c.stage,
      lastDirection: last.direction,
      lastAt: last.sentAt,
      lastBody: last.body,
    });
    n++;
    if (n >= limitContacts) break;
  }
  return tips;
}

/**
 * 扫描并 upsert 自动跟进；已有未完成的同 id 则更新 due/note，已完成则不复活。
 */
export function applyFollowUpAutomation(opts: {
  contacts: Contact[];
  messages: Message[];
  followUps: FollowUp[];
  now?: Date;
  rules?: FollowUpRule[];
  /** due = now + graceHours（给一点缓冲，默认 2h 后） */
  dueGraceHours?: number;
}): FollowUpAutomationResult {
  const now = opts.now || new Date();
  const nowMs = now.getTime();
  const rules = opts.rules || DEFAULT_FOLLOW_UP_RULES;
  const grace = opts.dueGraceHours ?? 2;

  const tips = buildTips(opts.contacts, opts.messages);
  const byId = new Map(opts.followUps.map((f) => [f.id, f]));
  const created: FollowUp[] = [];
  let contacts = opts.contacts;

  // 到期时间必须用「本地朴素」格式（与手动创建的 dueAt 完全同构）：
  // 下游 todayBoard/calcStats 都用 slice(0,10) 与本地日历日做字典序比较，
  // 写成 UTC ISO 串会在东八区/西八区整体偏移一天（今天建的单子明天才出现）。
  const due = new Date(nowMs + grace * 3600_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const dueAt = `${due.getFullYear()}-${pad(due.getMonth() + 1)}-${pad(
    due.getDate()
  )}T${pad(due.getHours())}:${pad(due.getMinutes())}`;

  for (const tip of tips) {
    const contact = contacts.find((c) => c.id === tip.contactId);
    if (!contact) continue;

    // 已有人工未完成跟进 → 不叠自动单（避免吵）
    const hasManualOpen = opts.followUps.some(
      (f) =>
        f.contactId === tip.contactId &&
        !f.done &&
        !isAutoFollowUpId(f.id)
    );
    if (hasManualOpen) continue;

    for (const rule of rules) {
      if (!ruleMatches(rule, tip, nowMs)) continue;

      const id = autoFollowUpId(rule.id, tip.contactId);
      const existing = byId.get(id);
      if (existing?.done) continue;

      const note = formatRuleNote(rule);
      if (existing) {
        // 已存在未完成：只在备注/到期过旧时轻量刷新 due
        continue;
      }

      const row: FollowUp = {
        id,
        contactId: tip.contactId,
        contactName: contact.name,
        dueAt,
        note,
        done: false,
      };
      byId.set(id, row);
      created.push(row);

      // 写 nextFollowUpAt（更早的不覆盖）
      const prevNext = contact.nextFollowUpAt;
      const prevT = prevNext ? Date.parse(prevNext) : Infinity;
      const dueT = Date.parse(dueAt);
      if (!prevNext || dueT < prevT) {
        contacts = contacts.map((c) =>
          c.id === contact.id ? { ...c, nextFollowUpAt: dueAt.slice(0, 10) } : c
        );
      }

      // 同一客户只应用第一条命中规则
      break;
    }
  }

  // 合并：非自动 + 自动 map
  const manual = opts.followUps.filter((f) => !isAutoFollowUpId(f.id));
  const autos = [...byId.values()].filter((f) => isAutoFollowUpId(f.id));
  const followUps = [...autos, ...manual].slice(0, 2000);

  return { followUps, contacts, created };
}
