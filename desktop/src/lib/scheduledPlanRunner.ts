import { activePlanStep, inQuietHours, planSteps, reconcileScheduledPlanReceipt, scheduledPlanCanTakeTurn, scheduledPlanOrder, SCHEDULED_START_GRACE_MS, type ScheduledPlan, type ScheduledPlanItem } from "./scheduledPlans";
import type { Message } from "../types/crm";

export type ScheduledPlanSendResult = { ok: boolean; error?: string; message?: string; retryAfterMs?: number; uncertain?: boolean; remoteId?: string; deferredForLock?: boolean };
type Dependencies = {
  plans: () => ScheduledPlan[];
  ready: () => boolean;
  isLocked?: () => boolean;
  update: (id: string, change: (plan: ScheduledPlan) => ScheduledPlan) => Promise<void>;
  availability: (item: ScheduledPlanItem) => "ready" | "offline" | "missing";
  enqueue: (plan: ScheduledPlan, item: ScheduledPlanItem) => string | null;
  send: (plan: ScheduledPlan, item: ScheduledPlanItem, canSend: () => boolean) => Promise<ScheduledPlanSendResult>;
  finish: (messageId: string, result: ScheduledPlanSendResult) => void;
  messages?: () => Message[];
  now?: () => number;
  hasTurn?: (id: string) => boolean;
};

/** One serial dispatcher for every plan and account; no sleeps or parallel fan-out. */
export function createScheduledPlanRunner(deps: Dependencies) {
  let busy = false, stopped = false;
  const now = deps.now || Date.now;
  const iso = (time: number) => new Date(time).toISOString();
  const changeItem = (p: ScheduledPlan, id: string, patch: Partial<ScheduledPlanItem>) => ({ ...p, items: p.items.map(item => item.id === id ? { ...item, ...patch } : item) });
  const markForReview = (p: ScheduledPlan, id: string) => {
    const next = changeItem(p, id, { status: p.status === "cancelled" ? "cancelled" : "failed", error: "planQueue.missingTarget" });
    return { ...next, offlineSince: undefined, nextAttemptAt: undefined,
      status: p.status === "running" && !next.items.some(item => item.status === "pending") ? "done" as const : p.status,
      error: "planQueue.missingTarget" };
  };
  let receiptSource: Message[] | undefined;
  let receipts = new Map<string, Message>();
  const reconcile = (plan: ScheduledPlan) => {
    const items = plan.items.map(item => {
      if (!item.messageId || !["sending", "failed", "unknown"].includes(item.status)) return item;
      const messages = deps.messages?.();
      if (messages !== receiptSource) {
        receiptSource = messages;
        receipts = new Map(messages?.map(message => [message.id, message]));
      }
      return reconcileScheduledPlanReceipt(plan, item, receipts.get(item.messageId));
    });
    if (items.every((item, i) => item === plan.items[i])) return plan;
    if (plan.status === "paused" && items.every(item => item.status === "sent" || item.status === "cancelled")) {
      return { ...plan, items, status: "done" as const, error: undefined };
    }
    const resolvedError = plan.items.some((item, i) => item !== items[i] && item.error === plan.error) &&
      !items.some(item => ["failed", "unknown", "sending"].includes(item.status));
    return { ...plan, items, error: resolvedError ? undefined : plan.error };
  };
  return {
    stop() { stopped = true; },
    async tick() {
      if (busy || stopped || !deps.ready()) return;
      busy = true;
      let attempt: { plan: ScheduledPlan; item: ScheduledPlanItem; messageId: string } | undefined;
      try {
        for (const plan of deps.plans()) {
          if (reconcile(plan) !== plan) await deps.update(plan.id, reconcile);
          if (stopped) return;
        }
        for (const plan of deps.plans()) {
          if (["pending", "running"].includes(plan.status) && plan.endAt && Date.parse(plan.endAt) <= now()) {
            await deps.update(plan.id, p => ({...p,status:"expired",error:"planQueue.deadlineReached"})); continue;
          }
          if (plan.status !== "pending" || Date.parse(plan.dueAt) > now()) continue;
          const expired = !Number.isFinite(Date.parse(plan.dueAt)) || now() - Date.parse(plan.dueAt) > SCHEDULED_START_GRACE_MS;
          await deps.update(plan.id, current => current.status !== "pending" ? current : {
            ...current, status: expired ? "expired" : "running", startedAt: expired ? undefined : iso(now()),
            error: expired ? "planQueue.expired" : undefined,
          });
          if (stopped) return;
        }
        const at = now();
        const plan = deps.plans().filter(p => p.status === "running" && scheduledPlanCanTakeTurn(p, at)).sort(scheduledPlanOrder)[0];
        if (!plan) return;
        if (deps.hasTurn && !deps.hasTurn(plan.id)) return;
        if (plan.mediaUnavailable) { await deps.update(plan.id, p => ({ ...p, status: "paused", error: "planQueue.mediaMissing" })); return; }
        if (plan.items.some(item => item.status === "sending")) {
          await deps.update(plan.id, p => ({ ...p, status: "paused", error: "planQueue.interrupted",
            items: p.items.map(item => item.status === "sending" ? { ...item, status: "unknown", error: "planQueue.interrupted" } : item) }));
          return;
        }
        const first = plan.items.find(item => item.status === "pending");
        if (!first) { await deps.update(plan.id, p => ({ ...p, status: "done", error: undefined })); return; }
        const cooldown = Math.max(0, ...deps.plans().map(p => Date.parse(p.cooldownUntil || "") || 0));
        if (now() < cooldown || now() < (Date.parse(plan.nextAttemptAt || "") || 0)) return;
        const firstAvailability = deps.availability(first);
        if (firstAvailability === "missing") {
          await deps.update(plan.id, p => markForReview(p, first.id)); return;
        }
        const offlineExpired = !!plan.offlineSince && at - Date.parse(plan.offlineSince) >= SCHEDULED_START_GRACE_MS;
        const canUseAlternative = (candidate: ScheduledPlanItem) => candidate.status === "pending" &&
          candidate.accountId !== first.accountId && deps.availability(candidate) === "ready";
        const continuing = plan.offlineSince && plan.items.find(candidate => (candidate.stepIndex || 0) > 0 && canUseAlternative(candidate));
        const waitingForOriginal = firstAvailability === "offline" || offlineExpired;
        const item = continuing || (waitingForOriginal
          ? plan.items.find(canUseAlternative)
          : first);
        if (!item && offlineExpired) {
          await deps.update(plan.id, p => ({ ...p, status: "paused", error: "planQueue.offlineExpired" })); return;
        }
        if (!item) {
          await deps.update(plan.id, p => ({ ...p, offlineSince: p.offlineSince || iso(now()), error: "planQueue.offline", nextAttemptAt: iso(now() + 5000) }));
          return;
        }
        const messageId = deps.enqueue(plan, item);
        if (!messageId) { await deps.update(plan.id, p => ({ ...p, status: "paused", error: "planQueue.cannotQueue" })); return; }
        attempt = { plan, item, messageId };
        const offlineSince = item !== first ? plan.offlineSince || iso(at) : undefined;
        await deps.update(plan.id, p => ({ ...changeItem(p, item.id, { status: "sending", messageId, error: undefined, sequenceActivityAt: iso(now()) }), error: offlineSince ? "planQueue.offline" : undefined, offlineSince, nextAttemptAt: undefined }));
        let blockedByLock = false;
        const preflight: { availability?: ReturnType<Dependencies["availability"]> } = {};
        const canSend = () => {
          blockedByLock ||= deps.isLocked?.() === true;
          if (blockedByLock || stopped || !deps.ready() || inQuietHours(plan,now()) || (plan.endAt && Date.parse(plan.endAt) <= now()) ||
            !deps.plans().some(p => p.id === plan.id && p.status === "running" && p.items.some(i => i.id === item.id && i.status === "sending"))) return false;
          preflight.availability = deps.availability(item);
          return preflight.availability === "ready";
        };
        const started = canSend();
        const result: ScheduledPlanSendResult = started
          ? await deps.send(plan, { ...item, messageId }, canSend)
          : {ok:false, error:"automation_cancelled"};
        const deferredForLock = blockedByLock && !result.ok && !result.uncertain && result.error === "automation_cancelled";
        if (!result.ok && !result.uncertain && result.error === "automation_cancelled" && !blockedByLock) {
          if (preflight.availability === "missing") {
            deps.finish(messageId, { ok: false, error: "planQueue.missingTarget" });
            await deps.update(plan.id, p => markForReview(p, item.id));
            return;
          }
          if (preflight.availability === "offline") {
            deps.finish(messageId, { ok: false, error: "planQueue.offline" });
            await deps.update(plan.id, p => ({
              ...changeItem(p, item.id, { status: p.status === "cancelled" ? "cancelled" : "pending", error: "planQueue.offline" }),
              offlineSince: p.offlineSince || iso(now()), error: "planQueue.offline",
            }));
            return;
          }
        }
        if (!started || deferredForLock) {
          const stillRunning = deps.plans().some(p => p.id === plan.id && p.status === "running");
          deps.finish(messageId, deferredForLock && stillRunning ? {ok:false, deferredForLock:true} : {ok:false, error:"planQueue.stopped"});
          await deps.update(plan.id, p => changeItem(p, item.id, { status: p.status === "cancelled" ? "cancelled" : "pending", error:undefined }));
          return;
        }
        deps.finish(messageId, result);
        const finished = now();
        await deps.update(plan.id, current => {
          const cancelled = current.status === "cancelled";
          const cooling = result.error === "rate_limited" || result.error === "baileys_not_connected";
          const stepIndex = item.stepIndex || 0;
          const moreSteps = result.ok && stepIndex + 1 < planSteps(plan).length;
          const gap = activePlanStep(plan,item)?.gapSec || plan.gapSec;
          const status = result.ok ? moreSteps ? cancelled ? "cancelled" : "pending" : "sent" : result.uncertain ? "unknown" : cancelled ? "cancelled" : cooling || result.error === "automation_cancelled" ? "pending" : "failed";
          const next = changeItem(current, item.id, { status, sentAt: result.ok && !moreSteps ? iso(finished) : undefined, error: result.ok ? undefined : result.message || result.error,
            stepIndex: result.ok ? stepIndex + 1 : stepIndex, messageId: moreSteps ? undefined : messageId,
            messageIds: result.ok ? [...new Set([...(item.messageIds || []), messageId])] : item.messageIds });
          const hasPending = next.items.some(i => i.status === "pending");
          const deadlineReached = !!plan.endAt && Date.parse(plan.endAt) <= finished;
          const quiet = result.error === "automation_cancelled" && inQuietHours(plan,finished);
          return { ...next, cooldownUntil: iso(finished + gap * 1000),
            nextAttemptAt: quiet ? iso(finished+60000) : cooling ? iso(finished + Math.max(gap * 1000, result.retryAfterMs || 5000)) : undefined,
            status: current.status !== "running" ? current.status : deadlineReached && hasPending ? "expired" : result.ok ? hasPending ? "running" : "done" : cooling || quiet ? "running" : "paused",
            error: cancelled && result.uncertain ? "planQueue.cancelledUnknown" : deadlineReached && hasPending ? "planQueue.deadlineReached" : quiet ? "planQueue.quietNow" : result.ok ? offlineSince && hasPending ? "planQueue.offline" : undefined : result.message || result.error || "planQueue.failed",
          };
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : "planQueue.failed";
        if (attempt) {
          deps.finish(attempt.messageId, { ok: false, uncertain: true, message: reason });
          await deps.update(attempt.plan.id, p => ({ ...changeItem(p, attempt!.item.id, { status: "unknown", error: reason }), status: p.status === "cancelled" ? "cancelled" : "paused", error: p.status === "cancelled" ? "planQueue.cancelledUnknown" : reason,
            cooldownUntil: iso(now() + attempt!.plan.gapSec * 1000) })).catch(() => undefined);
        } else {
          const active = deps.plans().find(plan => plan.status === "running");
          if (active) await deps.update(active.id, p => ({ ...p, status: "paused", error: reason })).catch(() => undefined);
        }
      } finally { busy = false; }
    },
  };
}
