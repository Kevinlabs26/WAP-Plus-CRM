import { resolveEffectiveLimits, type SendGateConfig } from "../channels/sendGate";
import { checkRateLimit, rateLimitSnapshot } from "../channels/rateLimit";
import { planSteps, scheduledPlanOrder, type ScheduledPlan, type ScheduledPlanItem } from "./scheduledPlans";
import type { Message } from "../types/crm";
import type { BroadcastCampaign } from "../types/broadcast";

export function planItemReceipt(item: Pick<ScheduledPlanItem,"status"|"messageIds"|"messageId">, messages: Map<string, Message>) {
  const ids = item.messageIds?.length ? item.messageIds : item.messageId ? [item.messageId] : [];
  const statuses = ids.map(id=>messages.get(id)?.deliveryStatus);
  if (item.status !== "sent" || !statuses.length) return "submitted";
  if (statuses.every(s=>s === "read" || s === "played")) return "read";
  if (statuses.every(s=>s === "delivered" || s === "read" || s === "played")) return "delivered";
  return "submitted";
}

/** Estimate includes work ahead and quota pacing; uploads and future pauses remain unknown. */
export function estimatePlanMinutes(plan: ScheduledPlan, plans: ScheduledPlan[], campaigns: BroadcastCampaign[], config: SendGateConfig, now = Date.now()) {
  const ordered = plans.filter(p=>p.id===plan.id || ["pending","running"].includes(p.status) && scheduledPlanOrder(p,plan)<0 && Date.parse(p.dueAt)<=Math.max(now,Date.parse(plan.dueAt)));
  const counts = new Map<string,number>();let seconds=0,wait=0;
  for (const p of ordered) {
    const steps=planSteps(p);
    wait=Math.max(wait,((Date.parse(p.nextAttemptAt || "")||0)-now)/1000,((Date.parse(p.cooldownUntil || "")||0)-now)/1000);
    for (const item of p.items) if (["pending","sending"].includes(item.status)) {
      const remaining=steps.slice(item.stepIndex||0);
      counts.set(item.accountId,(counts.get(item.accountId)||0)+remaining.length);
      seconds+=remaining.reduce((sum,s)=>sum+(s.gapSec||p.gapSec),0);
    }
  }
  for (const c of campaigns.filter(c=>c.status==="running")) {
    const count=c.items.filter(i=>["pending","sending"].includes(i.status)).length;
    counts.set(c.accountId,(counts.get(c.accountId)||0)+count);seconds+=count*Math.max(20,c.extraGapSec);
  }
  for (const [accountId,count] of counts) {
    const limits=resolveEffectiveLimits(config,accountId).limits;
    const snapshot=rateLimitSnapshot("",null,limits,accountId);
    const gate=checkRateLimit("",null,limits,{accountId,globalMinGapSec:config.globalMinGapSec});
    if (!gate.ok) wait=Math.max(wait,(gate.retryAfterMs||0)/1000);
    seconds=Math.max(seconds,Math.max(0,count-1)*limits.minIntervalSec,
      Math.floor(Math.max(0,count+snapshot.lastMinute-1)/limits.perPhonePerMinute)*60,
      Math.floor(Math.max(0,count+snapshot.lastHour-1)/limits.perPhonePerHour)*3600);
  }
  return Math.max(1,Math.ceil((seconds+Math.max(0,wait))/60));
}
