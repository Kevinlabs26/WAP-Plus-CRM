import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { useI18n, type TranslationKey } from "@/i18n";
import { nextBatchTask } from "@/lib/scheduledPlans";
import { updateScheduledPlan } from "@/lib/scheduledPlanActions";
import { useAppStore } from "@/store/appStore";

export function BatchTaskIndicator() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [focusedPlanId, setFocusedPlanId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now);
  const root = useRef<HTMLDivElement>(null);
  const plans = useAppStore(state => state.settings.scheduledPlans || []);
  const campaigns = useAppStore(state => state.broadcastCampaigns || []);
  const accounts = useAppStore(state => state.settings.waAccounts || []);
  const active = [
    ...plans.filter(plan => ["pending", "running", "paused"].includes(plan.status) || open && plan.id === focusedPlanId).map(plan => ({ ...plan, kind: "plan" as const })),
    ...campaigns.filter(campaign => ["draft", "running", "paused"].includes(campaign.status)).map(campaign => ({ ...campaign, kind: "campaign" as const })),
  ].sort((a, b) => Number(b.id === focusedPlanId) - Number(a.id === focusedPlanId) || rank(a.status) - rank(b.status));
  const running = active.some(task => task.status === "running");
  const allPaused = active.every(task => task.status === "paused");
  const sentTotal = active.reduce((sum, task) => sum + task.items.filter(item => item.status === "sent").length, 0);
  const recipientTotal = active.reduce((sum, task) => sum + task.items.length, 0);
  const nextId = nextBatchTask(plans, campaigns, now);
  const cooldown = Math.max(0, ...plans.map(plan => Date.parse(plan.cooldownUntil || "") || 0));
  useEffect(() => {
    const showProgress = (event: Event) => {
      setFocusedPlanId((event as CustomEvent<{ planId?: string }>).detail?.planId || null);
      setNow(Date.now()); setOpen(true);
    };
    window.addEventListener("wap:open-batch-progress", showProgress);
    return () => window.removeEventListener("wap:open-batch-progress", showProgress);
  }, []);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    document.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", escape);
    return () => { window.clearInterval(timer); document.removeEventListener("pointerdown", outside); window.removeEventListener("keydown", escape); };
  }, [open]);
  if (!active.length) return null;

  return <div ref={root} className="relative">
    <button type="button" aria-label={t("planQueue.progressTitle")} aria-expanded={open} onClick={() => setOpen(value => !value)} className="ui-btn-secondary flex !min-h-8 items-center gap-1.5 px-2 text-xs text-brand" title={t("planQueue.progressTitle")}>
      {allPaused ? <Pause className="h-3.5 w-3.5" /> : <LoaderCircle className={running ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />}
      <span className="hidden sm:inline">{t("planQueue.progressTitle")}{allPaused ? " · " + t("planQueue.status.paused") : ""}</span>
      <span className="tabular-nums">{sentTotal}/{recipientTotal}</span>
    </button>
    {open && <div role="region" aria-label={t("planQueue.progressTitle")} className="absolute right-0 top-full z-50 mt-2 max-h-[70vh] w-96 max-w-[calc(100vw-1rem)] space-y-3 overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 p-3 shadow-xl">
      {active.map(task => {
        const sent = task.items.filter(item => item.status === "sent").length;
        const failed = task.items.filter(item => item.status === "failed" || item.status === "unknown").length;
        const current = task.items.find(item => item.status === "sending") || task.items.find(item => item.status === "pending");
        const accountId = current?.accountId || ("accountId" in task ? task.accountId : undefined);
        const accountLabel = accounts.find(account => account.id === accountId)?.label || accountId;
        const total = task.items.length;
        const error = "error" in task ? task.error : undefined;
        const waitSec = task.kind === "plan" ? Math.max(0, Math.ceil((Math.max(cooldown, Date.parse(task.nextAttemptAt || "") || 0) - now) / 1000)) : 0;
        return <div key={task.id} className="flex items-center gap-2 border-b border-zinc-800 pb-2 last:border-0 last:pb-0">
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-zinc-200">{task.title || t("planQueue.bulkTitle")}</p>
            <p className="mt-1 text-xs text-brand">{t(`planQueue.status.${task.status === "draft" ? "pending" : task.status}` as TranslationKey)}</p>
            <p className="mt-1 break-words text-xs leading-relaxed text-zinc-500">{t("planQueue.progress", { sent, total, failed, pending: task.items.filter(item => item.status === "pending" || item.status === "sending").length })}{current ? ` · ${current.contactName}` : ""}{accountLabel ? ` · ${accountLabel}` : ""}</p>
            <div role="progressbar" aria-label={t("planQueue.progressTitle")} aria-valuemin={0} aria-valuemax={total || 1} aria-valuenow={sent} className="mt-2 h-1.5 overflow-hidden rounded bg-zinc-800"><div className="h-full bg-brand transition-all" style={{ width: `${total ? sent / total * 100 : 0}%` }} /></div>
            {error && <p role="status" className="mt-1 break-words text-xs text-amber-500">{error.startsWith("planQueue.") ? t(error as TranslationKey) : error}</p>}
            {task.status === "paused" && current?.status === "sending" && <p className="mt-1 text-xs text-amber-500">{t("planQueue.pausingInFlight")}</p>}
            {task.status === "running" && !error && current?.status !== "sending" && nextId && nextId !== task.id && <p className="mt-1 text-xs text-zinc-500">{t("planQueue.waitingTurn")}</p>}
            {task.status === "running" && waitSec > 0 && current?.status !== "sending" && <p className="mt-1 text-xs text-zinc-500">{t("planQueue.wait", { seconds: waitSec })}</p>}
            <button type="button" className="mt-1 text-xs text-brand hover:underline" onClick={() => { setOpen(false); if (task.kind === "plan") useAppStore.getState().setSettingsOpen(true, "scheduled"); else useAppStore.getState().setActiveNav("broadcast"); }}>{t("planQueue.details")}</button>
          </div>
          {task.status === "running" || task.kind === "plan" && task.status === "pending" ? <Button size="sm" aria-label={t("planQueue.pause")} title={t("planQueue.pause")} onClick={() => task.kind === "plan" ? void updateScheduledPlan(task.id, plan => ["pending", "running"].includes(plan.status) ? { ...plan, status: "paused", error: "planQueue.userPaused" } : plan).catch(error => useAppStore.getState().pushToast(error instanceof Error ? error.message : String(error), "error")) : useAppStore.getState().pauseBroadcastCampaign(task.id)}><Pause className="h-3.5 w-3.5" /><span>{t("planQueue.pauseShort")}</span></Button> : task.status === "paused" ? <Button size="sm" disabled={task.items.some(item => item.status === "sending") || task.kind === "plan" && task.mediaUnavailable} aria-label={t("planQueue.resume")} title={t("planQueue.resume")} onClick={() => {
            if (task.kind === "plan") void updateScheduledPlan(task.id, plan => plan.status === "paused" ? { ...plan, status: plan.startedAt ? "running" : "pending", error: undefined, offlineSince: undefined, nextAttemptAt: undefined } : plan).catch(error => useAppStore.getState().pushToast(error instanceof Error ? error.message : String(error), "error"));
            else {
              const result = useAppStore.getState().resumeBroadcastCampaign(task.id);
              if (!result.ok) useAppStore.getState().pushToast(result.reason, "error");
            }
          }}><Play className="h-3.5 w-3.5" /><span>{t("planQueue.resumeShort")}</span></Button> : null}
        </div>;
      })}
    </div>}
  </div>;
}

function rank(status: string) {
  return status === "running" ? 0 : status === "paused" ? 1 : 2;
}
