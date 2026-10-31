import { activePlanStep, inQuietHours, ownsBatchTurn, planSteps, scheduledPlanOrder, SCHEDULED_START_GRACE_MS, type ScheduledPlan, type ScheduledPlanItem } from "./scheduledPlans";

export type ScheduledPlanSendResult = { ok: boolean; error?: string; message?: string; retryAfterMs?: number; uncertain?: boolean; remoteId?: string };
type Dependencies = {
  plans: () => ScheduledPlan[];
  ready: () => boolean;
  update: (id: string, change: (plan: ScheduledPlan) => ScheduledPlan) => Promise<void>;
  availability: (item: ScheduledPlanItem) => "ready" | "offline" | "missing";
  enqueue: (plan: ScheduledPlan, item: ScheduledPlanItem) => string | null;
  send: (plan: ScheduledPlan, item: ScheduledPlanItem, canSend: () => boolean) => Promise<ScheduledPlanSendResult>;
  finish: (messageId: string, result: ScheduledPlanSendResult) => void;
  now?: () => number;
  hasTurn?: (id: string) => boolean;
};

/** One serial dispatcher for every plan and account; no sleeps or parallel fan-out. */
export function createScheduledPlanRunner(deps: Dependencies) {
  let busy = false, stopped = false;
  const now = deps.now || Date.now;
  const iso = (time: number) => new Date(time).toISOString();
  const changeItem = (p: ScheduledPlan, id: string, patch: Partial<ScheduledPlanItem>) => ({ ...p, items: p.items.map(item => item.id === id ? { ...item, ...patch } : item) });
  return {
    stop() { stopped = true; },
    async tick() {
      if (busy || stopped || !deps.ready()) return;
      busy = true;
      let attempt: { plan: ScheduledPlan; item: ScheduledPlanItem; messageId: string } | undefined;
      try {
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
        const plan = [...deps.plans()].filter(p => p.status === "running" && (ownsBatchTurn(p) && !p.offlineSince && !inQuietHours(p,now()) || !(Date.parse(p.nextAttemptAt || "") > now()))).sort(scheduledPlanOrder)[0];
        if (!plan) return;
        if (inQuietHours(plan, now())) { await deps.update(plan.id,p=>({...p,nextAttemptAt:iso(now()+60000),error:"planQueue.quietNow"})); return; }
        if (deps.hasTurn && !deps.hasTurn(plan.id)) return;
        if (plan.mediaUnavailable) { await deps.update(plan.id, p => ({ ...p, status: "paused", error: "planQueue.mediaMissing" })); return; }
        if (plan.items.some(item => item.status === "sending")) {
          await deps.update(plan.id, p => ({ ...p, status: "paused", error: "planQueue.interrupted",
            items: p.items.map(item => item.status === "sending" ? { ...item, status: "unknown", error: "planQueue.interrupted" } : item) }));
          return;
        }
        const item = plan.items.find(item => item.status === "pending");
        if (!item) { await deps.update(plan.id, p => ({ ...p, status: "done", error: undefined })); return; }
        const cooldown = Math.max(0, ...deps.plans().map(p => Date.parse(p.cooldownUntil || "") || 0));
        if (now() < cooldown || now() < (Date.parse(plan.nextAttemptAt || "") || 0)) return;
        const availability = deps.availability(item);
        if (plan.offlineSince && now() - Date.parse(plan.offlineSince) >= SCHEDULED_START_GRACE_MS) {
          await deps.update(plan.id, p => ({ ...p, status: "paused", error: "planQueue.offlineExpired" })); return;
        }
        if (availability !== "ready") {
          await deps.update(plan.id, p => availability === "offline"
            ? { ...p, offlineSince: p.offlineSince || iso(now()), error: "planQueue.offline", nextAttemptAt: iso(now() + 5000) }
            : { ...changeItem(p, item.id, { status: "failed", error: "planQueue.missingTarget" }), status: "paused", error: "planQueue.missingTarget" });
          return;
        }
        const messageId = deps.enqueue(plan, item);
        if (!messageId) { await deps.update(plan.id, p => ({ ...p, status: "paused", error: "planQueue.cannotQueue" })); return; }
        attempt = { plan, item, messageId };
        await deps.update(plan.id, p => ({ ...changeItem(p, item.id, { status: "sending", messageId, error: undefined, sequenceActivityAt: iso(now()) }), error: undefined, offlineSince: undefined, nextAttemptAt: undefined }));
        const canSend = () => !stopped && deps.ready() && deps.availability(item) === "ready" && !inQuietHours(plan,now()) && !(plan.endAt && Date.parse(plan.endAt) <= now()) && deps.plans().some(p => p.id === plan.id && p.status === "running" && p.items.some(i => i.id === item.id && i.status === "sending"));
        if (!canSend()) {
          const cancelled = { ok: false, error: "planQueue.stopped" };
          deps.finish(messageId, cancelled);
          await deps.update(plan.id, p => changeItem(p, item.id, { status: p.status === "cancelled" ? "cancelled" : "pending" }));
          return;
        }
        const result = await deps.send(plan, { ...item, messageId }, canSend);
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
            error: cancelled && result.uncertain ? "planQueue.cancelledUnknown" : deadlineReached && hasPending ? "planQueue.deadlineReached" : quiet ? "planQueue.quietNow" : result.ok ? undefined : result.message || result.error || "planQueue.failed",
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
