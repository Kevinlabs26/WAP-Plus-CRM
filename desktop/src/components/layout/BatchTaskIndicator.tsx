import { useState } from "react";
import { LoaderCircle, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { useI18n } from "@/i18n";
import { updateScheduledPlan } from "@/lib/scheduledPlanActions";
import { useAppStore } from "@/store/appStore";

export function BatchTaskIndicator() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const plans = useAppStore(state => state.settings.scheduledPlans || []);
  const campaigns = useAppStore(state => state.broadcastCampaigns || []);
  const accounts = useAppStore(state => state.settings.waAccounts || []);
  const active = [
    ...plans.filter(plan => ["pending", "running", "paused"].includes(plan.status)).map(plan => ({ ...plan, kind: "plan" as const })),
    ...campaigns.filter(campaign => ["draft", "running", "paused"].includes(campaign.status)).map(campaign => ({ ...campaign, kind: "campaign" as const })),
  ].sort((a, b) => rank(a.status) - rank(b.status));
  const running = active.some(task => task.status === "running");
  if (!active.length) return null;

  return <div className="relative">
    <button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)} className="ui-btn-secondary flex !min-h-8 items-center gap-1.5 px-2 text-xs text-brand" title={t("planQueue.progressTitle")}>
      <LoaderCircle className={running ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
      <span className="hidden sm:inline">{t("planQueue.progressTitle")}</span>
      <span className="tabular-nums">{active.length}</span>
    </button>
    {open && <div className="absolute right-0 top-full z-50 mt-2 max-h-80 w-72 max-w-[calc(100vw-1rem)] space-y-2 overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 p-3 shadow-xl">
      {active.map(task => {
        const sent = task.items.filter(item => item.status === "sent").length;
        const failed = task.items.filter(item => item.status === "failed" || item.status === "unknown").length;
        const current = task.items.find(item => item.status === "sending") || task.items.find(item => item.status === "pending");
        const accountId = current?.accountId || ("accountId" in task ? task.accountId : undefined);
        const accountLabel = accounts.find(account => account.id === accountId)?.label || accountId;
        const total = task.items.length;
        return <div key={task.id} className="flex items-center gap-2 border-b border-zinc-800 pb-2 last:border-0 last:pb-0">
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-zinc-200">{task.title || t("planQueue.bulkTitle")}</p>
            <p className="truncate text-2xs text-zinc-500">{t("planQueue.progress", { sent, total, failed, pending: task.items.filter(item => item.status === "pending" || item.status === "sending").length })}{current ? ` · ${current.contactName}` : ""}{accountLabel ? ` · ${accountLabel}` : ""}</p>
          </div>
          {task.status === "running" ? <Button size="sm" aria-label={t("planQueue.pause")} title={t("planQueue.pause")} onClick={() => task.kind === "plan" ? void updateScheduledPlan(task.id, plan => plan.status === "running" ? { ...plan, status: "paused", error: "planQueue.userPaused" } : plan).catch(error => useAppStore.getState().pushToast(error instanceof Error ? error.message : String(error), "error")) : useAppStore.getState().pauseBroadcastCampaign(task.id)}><Pause className="h-3.5 w-3.5" /></Button> : task.status === "paused" ? <Button size="sm" aria-label={t("planQueue.resume")} title={t("planQueue.resume")} onClick={() => {
            if (task.kind === "plan") void updateScheduledPlan(task.id, plan => plan.status === "paused" ? { ...plan, status: plan.startedAt ? "running" : "pending", error: undefined, offlineSince: undefined, nextAttemptAt: undefined } : plan).catch(error => useAppStore.getState().pushToast(error instanceof Error ? error.message : String(error), "error"));
            else {
              const result = useAppStore.getState().resumeBroadcastCampaign(task.id);
              if (!result.ok) useAppStore.getState().pushToast(result.reason, "error");
            }
          }}><Play className="h-3.5 w-3.5" /></Button> : null}
        </div>;
      })}
    </div>}
  </div>;
}

function rank(status: string) {
  return status === "running" ? 0 : status === "paused" ? 1 : 2;
}
