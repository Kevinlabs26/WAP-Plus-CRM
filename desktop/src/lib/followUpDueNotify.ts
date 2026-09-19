/**
 * 跟进到期 → 桌面通知（点击打开客户工作区）。
 * 按 followUp.id 去重，避免轮询重复轰炸。
 */
import { showDesktopNotify } from "@/lib/desktopNotify";
import { followUpDayKey, localDayKey } from "@/lib/todayBoard";
import type { FollowUp } from "@/types/crm";

const notified = new Map<string, number>();
/** 同一跟进 6 小时内只提醒一次（完成/改期后 id 变或 done 则自然不再出现） */
const DEDUPE_MS = 6 * 3600_000;

export type FollowUpDueHandlers = {
  enabled: boolean;
  /** 正在「今日」页且窗口前台时可选抑制 */
  suppressWhenFocusedToday?: boolean;
  activeNav?: string;
  openFollowUp: (f: FollowUp) => void;
};

function formatDue(dueAt: string): string {
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(dueAt || "")) {
    return `${dueAt.slice(0, 10)} ${dueAt.slice(11, 16)}`;
  }
  return (dueAt || "").slice(0, 10);
}

/**
 * 扫描待办：已到期（日期 ≤ 今天）的未完成跟进。
 * 带时刻的 dueAt：若本地日是今天但时刻未到，仍可在「今日」列表展示；
 * 通知策略：日期 < 今天一律提醒；日期 === 今天则在 due 时刻已过或无时刻时提醒。
 */
export function notifyDueFollowUps(
  followUps: FollowUp[],
  handlers: FollowUpDueHandlers,
  now = new Date()
): number {
  if (!handlers.enabled) return 0;
  if (typeof document === "undefined") return 0;

  const windowFocused =
    typeof document.hasFocus === "function" ? document.hasFocus() : true;
  if (
    handlers.suppressWhenFocusedToday &&
    handlers.activeNav === "today" &&
    windowFocused &&
    !document.hidden
  ) {
    return 0;
  }

  const today = localDayKey(now);
  const nowMs = now.getTime();
  for (const [k, t] of notified) {
    if (nowMs - t > DEDUPE_MS) notified.delete(k);
  }

  let due: FollowUp[] = [];
  for (const f of followUps) {
    if (f.done || !f.id) continue;
    const day = followUpDayKey(f.dueAt);
    if (!day || day > today) continue;

    if (day === today && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(f.dueAt || "")) {
      const dueMs = Date.parse(f.dueAt);
      if (Number.isFinite(dueMs) && dueMs > nowMs) continue;
    }

    if (notified.has(f.id)) continue;
    due.push(f);
  }
  if (!due.length) return 0;

  // 同批多条 → 合并成一条汇总通知，避免「逾期未回」一堆 toast 轰炸
  const markNotified = (list: FollowUp[]) => {
    for (const f of list) notified.set(f.id, nowMs);
  };
  if (due.length === 1) {
    const f = due[0]!;
    markNotified(due);
    const overdue = followUpDayKey(f.dueAt) < today;
    void showDesktopNotify({
      title: overdue ? `逾期待跟进 · ${f.contactName}` : `跟进到期 · ${f.contactName}`,
      body: f.note
        ? `${formatDue(f.dueAt)} · ${f.note}`
        : `到期 ${formatDue(f.dueAt)} · 点击打开会话`,
      tag: `followup-${f.id}`,
      onClick: () => handlers.openFollowUp(f),
    });
    return 1;
  }

  const sorted = [...due].sort((a, b) =>
    (a.dueAt || "").localeCompare(b.dueAt || "")
  );
  const overdueCount = sorted.filter((f) => followUpDayKey(f.dueAt) < today).length;
  markNotified(sorted);
  const first = sorted[0]!;
  const title =
    overdueCount === sorted.length
      ? `${sorted.length} 项跟进已逾期`
      : `${sorted.length} 项跟进待处理`;
  const body = sorted
    .slice(0, 3)
    .map((f) => `${formatDue(f.dueAt)} · ${f.contactName}`)
    .join("、");
  const bodyText =
    sorted.length > 3
      ? `${body}… 等 ${sorted.length} 项`
      : body;
  void showDesktopNotify({
    title,
    body: bodyText,
    tag: `followup-batch-${today}`,
    onClick: () => handlers.openFollowUp(first),
  });
  return sorted.length;
}

/** 测试或完成跟进后可清出去重（可选） */
export function clearFollowUpNotifyDedupe(id?: string) {
  if (id) notified.delete(id);
  else notified.clear();
}
