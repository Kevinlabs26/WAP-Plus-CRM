import { MessageSquareText, Trash2, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button, Input } from "@/components/ui/primitives";
import { Avatar } from "@/components/ui/Avatar";
import { useAppStore } from "@/store/appStore";
import { useI18n, type TranslationKey } from "@/i18n";
import { cancelScheduledPlan, prioritizeBatchTask, updateScheduledPlan } from "@/lib/scheduledPlanActions";
import { batchTaskOrder, nextBatchTask, planSteps, scheduledPlanOrder, scheduledPlanMatchesFilter, type ScheduledPlan, type ScheduledPlanFilter } from "@/lib/scheduledPlans";
import { estimatePlanMinutes, planItemReceipt } from "@/lib/scheduledPlanProgress";
import { sendRuntimeFromSettings } from "@/channels";
import { flushPersist } from "@/store/appStore";

export function ScheduledPlansPanel({ filter, onFilterChange: setFilter }: { filter: ScheduledPlanFilter; onFilterChange: (filter: ScheduledPlanFilter) => void }) {
  const { t, locale } = useI18n();
  const plans = useAppStore(state => state.settings.scheduledPlans || []);
  const contacts = useAppStore(state => state.contacts);
  const contactsById = useMemo(() => new Map(contacts.map(contact => [contact.id, contact])), [contacts]);
  const settings = useAppStore(state=>state.settings);
  const campaigns = useAppStore(state=>state.broadcastCampaigns || []);
  const messages = useAppStore(state=>state.messages || []);
  const messagesById = useMemo(()=>new Map(messages.map(m=>[m.id,m])),[messages]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [itemPage, setItemPage] = useState(0);
  const [replanId, setReplanId] = useState<string | null>(null);
  const [newTime, setNewTime] = useState("");
  const [newEnd,setNewEnd] = useState("");
  const [now, setNow] = useState(Date.now);
  const [busy, setBusy] = useState(false);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  const reason = (error?: string) => error?.startsWith("planQueue.") ? t(error as TranslationKey) : error;
  const visible = plans.filter(plan => scheduledPlanMatchesFilter(plan, filter)).sort(scheduledPlanOrder);
  const waitUntil = Math.max(0, ...plans.map(plan => Date.parse(plan.cooldownUntil || "") || 0));
  const queue = [...plans.filter(p=>["pending","running","paused"].includes(p.status)),...campaigns.filter(c=>["draft","running","paused"].includes(c.status))].sort(batchTaskOrder);
  const nextId = nextBatchTask(plans,campaigns,now);

  return <div className="space-y-4">
    {!!queue.length&&<section className="space-y-2 rounded-lg border border-zinc-700 p-3">
      <h4 className="text-sm font-medium">{t("planQueue.totalQueue")}</h4>
      <p className="text-xs text-zinc-500">{t("planQueue.queueRules")}</p>
      {queue.map((task,index)=><div key={task.id} className="flex flex-wrap items-center gap-2 text-xs">
        <span className="min-w-0 flex-1 truncate">{index+1}. {task.title||task.id} · {t(`planQueue.status.${task.status==="draft"?"pending":task.status}` as TranslationKey)} {nextId===task.id?" · "+t("planQueue.nextTask"):""}</span>
        <Button size="sm" disabled={busy||task.items.some(i=>i.status==="sending")} onClick={()=>void run(()=>prioritizeBatchTask(task.id))}>{t("planQueue.prioritize")}</Button>
        {"accountId" in task&&<><Button size="sm" onClick={()=>useAppStore.getState().pauseBroadcastCampaign(task.id)}>{t("planQueue.pause")}</Button><Button size="sm" onClick={()=>useAppStore.getState().setActiveNav("broadcast")}>{t("planQueue.manageLegacy")}</Button></>}
      </div>)}
    </section>}
    {visible.map(plan => {
      const sent = plan.items.filter(item => item.status === "sent").length;
      const failed = plan.items.filter(item => item.status === "failed" || item.status === "unknown").length;
      const pending = plan.items.filter(item => item.status === "pending").length;
      const active = plan.items.find(item => item.status === "sending");
      const next = active || plan.items.find(item => item.status === "pending");
      const receipts=plan.items.map(item=>planItemReceipt(item,messagesById));
      const delivered=receipts.filter(r=>r==="delivered"||r==="read").length;
      const read=receipts.filter(r=>r==="read").length;
      const recipientPreview=plan.items.slice(0,3);
      const steps=planSteps(plan);
      const messagePreview=steps.map((step,index)=>step.text?`${steps.length>1?`${index+1}. `:""}${step.text}`:"").filter(Boolean).join(" · ");
      const waitSec = Math.max(0, Math.ceil((Math.max(waitUntil, Date.parse(plan.nextAttemptAt || "") || 0) - now) / 1000));
      const page = Math.min(itemPage, Math.max(0, Math.ceil(plan.items.length / 50) - 1));
      return <article key={plan.id} className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/35 p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0"><h4 className="font-medium text-zinc-100">{plan.title}</h4><p className="mt-1 text-xs text-zinc-500">{new Date(plan.dueAt).toLocaleString(locale, { timeZone: plan.timeZone || undefined })} · {plan.timeZone} · {t(plan.steps?.length?"planQueue.defaultPace":"planQueue.pace", { seconds: plan.gapSec })}</p></div>
          <div className="flex shrink-0 items-center gap-1">
            <span className="rounded bg-zinc-800 px-2 py-1 text-xs text-brand">{t(`planQueue.status.${plan.status}` as TranslationKey)}</span>
            {!!plan.items.length&&<Button size="xs" variant="ghost" className="!min-h-7 !px-2" aria-label={t("planQueue.details")} title={t("planQueue.details")} aria-expanded={expanded===plan.id} aria-controls={`scheduled-recipients-${plan.id}`} onClick={() => { setExpanded(expanded === plan.id ? null : plan.id); setItemPage(0); }}><Users className="h-3.5 w-3.5" /><span className="text-2xs tabular-nums">{plan.items.length}</span></Button>}
            {["done", "cancelled"].includes(plan.status) && !active && (Date.parse(plan.cooldownUntil || "") || 0) <= now && <Button size="xs" variant="ghost" className="!min-h-7 !px-2 text-rose-300 hover:text-rose-200" aria-label={t("settingsScheduled.deleteRecord")} title={t("settingsScheduled.deleteRecord")} disabled={busy} onClick={() => void remove(plan)}><Trash2 className="h-3.5 w-3.5" /></Button>}
          </div>
        </div>
        {!!messagePreview&&<div className="flex min-w-0 items-start gap-2 rounded-lg bg-zinc-900/45 px-2.5 py-2" title={messagePreview.slice(0,2000)}>
          <MessageSquareText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-500" />
          <p className="line-clamp-2 min-w-0 whitespace-pre-wrap break-words text-xs leading-5 text-zinc-300">{messagePreview}</p>
          {steps.length>1&&<span className="shrink-0 text-2xs text-zinc-500">{t("planQueue.sequenceCount",{count:steps.length})}</span>}
        </div>}
        {steps.some(step=>step.media)&&<div className="flex flex-wrap items-center gap-2">
          {steps.map((step,index)=>step.media&&<div key={index} className="flex min-w-0 items-center gap-1.5" title={step.media.fileName}>
            {step.media.kind==="image"&&<a href={step.media.dataUrl} target="_blank" rel="noreferrer"><img loading="lazy" src={step.media.dataUrl} alt={step.media.fileName} className="max-h-12 max-w-16 rounded object-contain" /></a>}
            {step.media.kind==="audio"&&<audio controls preload="none" src={step.media.dataUrl} aria-label={step.media.fileName} className="h-8 max-w-48" />}
            {step.media.kind==="video"&&<video controls preload="metadata" src={step.media.dataUrl} aria-label={step.media.fileName} className="max-h-12 max-w-20 rounded" />}
            {step.media.kind==="file"&&<a href={step.media.dataUrl} download={step.media.fileName} className="max-w-48 truncate text-xs text-brand underline">{step.media.fileName}</a>}
          </div>)}
        </div>}
        {!!plan.items.length && <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
          <span>{t("planQueue.recipientsLabel")}</span>
          {recipientPreview.map(item => {
            const contact=contactsById.get(item.contactId), name=item.contactName||item.recipient;
            return <span key={item.id} title={`${name} · ${item.recipient}`} className="inline-flex max-w-full items-center gap-1">
              <Avatar name={name} seed={item.contactId||item.recipient} src={contact?.avatarFullUrl||contact?.avatarUrl} size="sm" className="!h-5 !w-5 !text-[9px]" />
              <span className="max-w-[12rem] truncate">{name}</span>
            </span>;
          })}
          {plan.items.length>3&&<span>{t("planQueue.recipientPreviewMore",{count:plan.items.length-3})}</span>}
        </div>}
        <p className="text-xs text-zinc-400">{t("planQueue.progress", { sent, total: plan.items.length, failed, pending })}</p>
        <div role="progressbar" aria-label={t("planQueue.progressTitle")} aria-valuemin={0} aria-valuemax={plan.items.length || 1} aria-valuenow={sent} className="h-1.5 overflow-hidden rounded bg-zinc-800"><div className="h-full bg-brand transition-all" style={{ width: `${plan.items.length ? sent / plan.items.length * 100 : 0}%` }} /></div>
        {!!delivered && <p className="text-xs text-zinc-500">{t("planQueue.receipts",{delivered,read})}</p>}
        {plan.endAt&&<p className="text-xs text-amber-500">{t("planQueue.deadline")}: {new Date(plan.endAt).toLocaleString(locale,{timeZone:plan.timeZone})}</p>}
        {plan.quietHours&&<p className="text-xs text-zinc-500">{t("planQueue.quietHours")}: {plan.quietHours.start}–{plan.quietHours.end} · {plan.timeZone}</p>}
        {plan.status === "running" && next && <p className="text-xs text-brand">{t(active ? "planQueue.sendingTo" : "planQueue.nextTo", { name: next.contactName })}{!active && waitSec > 0 ? " · " + t("planQueue.wait", { seconds: waitSec }) : ""}<br />{t("planQueue.estimate", { minutes: estimatePlanMinutes(plan,plans,campaigns,sendRuntimeFromSettings(settings,messages),now) })}</p>}
        {plan.error && <p role="status" className="break-words text-xs text-amber-500">{reason(plan.error)}</p>}
        <div className="flex flex-wrap gap-2">
          {["pending", "running"].includes(plan.status) && <Button size="sm" disabled={busy} onClick={() => void run(() => updateScheduledPlan(plan.id, p => ["pending", "running"].includes(p.status) ? { ...p, status: "paused", error: "planQueue.userPaused" } : p))}>{t("planQueue.pause")}</Button>}
          {plan.status === "paused" && pending > 0 && <Button size="sm" disabled={busy || !!active || plan.mediaUnavailable} onClick={() => void resume(plan)}>{t("planQueue.resume")}</Button>}
          {["pending", "paused", "expired"].includes(plan.status) && !active && !plan.mediaUnavailable && <Button size="sm" onClick={() => { setReplanId(plan.id); setNewTime("");setNewEnd(plan.endAt?new Date(Date.parse(plan.endAt)-new Date(plan.endAt).getTimezoneOffset()*60000).toISOString().slice(0,16):""); }}>{t("scheduled.replan")}</Button>}
          {!["done", "cancelled"].includes(plan.status) && <Button size="sm" disabled={busy} onClick={() => void cancel(plan)}>{t("planQueue.cancel")}</Button>}
        </div>
        {replanId === plan.id && <div className="flex flex-wrap gap-2"><Input type="datetime-local" aria-label={t("planQueue.startTime")} value={newTime} onInput={event => setNewTime(event.currentTarget.value)} /><Button size="sm" disabled={busy || !(Date.parse(newTime) > now)} onClick={() => void run(async () => {
          if (!(Date.parse(newTime) > Date.now())) return;
          if(newEnd&&!(Date.parse(newEnd)>Date.parse(newTime)))throw new Error(t("planQueue.invalidDeadline"));
          await updateScheduledPlan(plan.id, p => {
            if (!["pending", "paused", "expired"].includes(p.status) || p.items.some(item => item.status === "sending")) throw new Error(t("scheduled.replanFailed"));
            return { ...p, status: "pending", dueAt: new Date(newTime).toISOString(),endAt:newEnd?new Date(newEnd).toISOString():undefined, startedAt: undefined, offlineSince: undefined, nextAttemptAt: undefined, error: undefined };
          }); setReplanId(null);
        })}>{t("dialog.save")}</Button><label className="text-xs">{t("planQueue.deadline")}<Input type="datetime-local" value={newEnd} onInput={e=>setNewEnd(e.currentTarget.value)}/></label></div>}
        {expanded === plan.id && <div id={`scheduled-recipients-${plan.id}`} className="space-y-2 border-t border-zinc-800 pt-3">
          {plan.items.slice(page * 50, page * 50 + 50).map((item, index) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded bg-zinc-900/50 p-2">
            <div className="flex min-w-0 flex-1 items-start gap-2"><Avatar name={item.contactName||item.recipient} seed={item.contactId||item.recipient} src={contactsById.get(item.contactId)?.avatarFullUrl||contactsById.get(item.contactId)?.avatarUrl} size="sm" /><div className="min-w-0 flex-1"><p className="truncate text-xs text-zinc-300">{page * 50 + index + 1}. {item.contactName || item.recipient}</p><p className="truncate text-xs text-zinc-500">{item.recipient} · {item.accountId}</p><p className="text-xs text-zinc-500">{t(`planQueue.item.${item.status}` as TranslationKey)} {reason(item.error)}</p></div></div>
            <span className="text-xs text-zinc-500">{t("planQueue.stepProgress",{current:item.status==="sent"?planSteps(plan).length:Math.min(item.stepIndex||0,planSteps(plan).length),total:planSteps(plan).length})} {item.status==="sent"?t(`planQueue.receipt.${planItemReceipt(item,messagesById)}`):""}</span>
            {item.status === "pending" && !["done", "cancelled"].includes(plan.status) && <Button size="sm" disabled={busy} onClick={() => void run(() => updateScheduledPlan(plan.id, p => ({ ...p, items: p.items.map(i => i.id === item.id && i.status === "pending" ? { ...i, status: "cancelled" } : i) })))}>{t("planQueue.removeTarget")}</Button>}
            {["failed", "unknown"].includes(item.status) && !item.retired && ["paused", "done"].includes(plan.status) && <Button size="sm" disabled={busy} onClick={() => void retry(plan, item.id)}>{t("planQueue.reviewRetry")}</Button>}
          </div>)}
          <div className="flex justify-between text-xs text-zinc-500"><Button size="sm" disabled={!page} onClick={() => setItemPage(page - 1)}>‹</Button><span>{page + 1}/{Math.max(1, Math.ceil(plan.items.length / 50))}</span><Button size="sm" disabled={(page + 1) * 50 >= plan.items.length} onClick={() => setItemPage(page + 1)}>›</Button></div>
        </div>}
      </article>;
    })}
  </div>;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try { await action(); }
    catch (error) { useAppStore.getState().pushToast(error instanceof Error ? error.message : t("planQueue.failed"), "error"); }
    finally { setBusy(false); }
  }
  async function askConfirmation(description: string) {
    return useAppStore.getState().requestConfirm({ title: t("settingsScheduled.title"), description, confirmLabel: t("common.confirm"), cancelLabel: t("common.cancel"), tone: "danger" });
  }
  async function resume(plan: ScheduledPlan) {
    if (!await askConfirmation(t("planQueue.resumeHint"))) return;
    await run(() => updateScheduledPlan(plan.id, p => p.status === "paused" && !p.items.some(item => item.status === "sending") ? { ...p, status: p.startedAt ? "running" : "pending", offlineSince: undefined, nextAttemptAt: undefined, error: undefined } : p));
  }
  async function cancel(plan: ScheduledPlan) {
    if (!await askConfirmation(t("planQueue.cancelHint"))) return;
    await run(() => cancelScheduledPlan(plan.id));
  }
  async function retry(plan: ScheduledPlan, itemId: string) {
    if (!await askConfirmation(t("planQueue.retryHint"))) return;
    await run(async () => {
      await updateScheduledPlan(plan.id, p => !["paused", "done"].includes(p.status) ? p : { ...p, status: "paused", items: p.items.map(item => {
        if(item.id!==itemId||item.retired||!["unknown","failed"].includes(item.status))return item;
        const message=useAppStore.getState().messages?.find(m=>m.id===item.messageId&&m.accountId===item.accountId);
        if(message&&["sent","server","delivered","read","played"].includes(message.deliveryStatus||"")) {
          const stepIndex=(item.stepIndex||0)+1;return {...item,stepIndex,status:stepIndex>=planSteps(p).length?"sent":"pending",messageId:undefined,messageIds:[...new Set([...(item.messageIds||[]),message.id])],error:undefined};
        }
        return {...item,status:"pending",messageId:undefined,error:undefined};
      }) });
      setFilter("active");
    });
  }
  async function remove(plan: ScheduledPlan) {
    if (!await askConfirmation(t("settingsScheduled.deleteDescription"))) return;
    await run(async () => {
      const state = useAppStore.getState();
      state.updateSettings({ scheduledPlans: state.settings.scheduledPlans.filter(p => p.id !== plan.id || !["done", "cancelled"].includes(p.status) || p.items.some(item => item.status === "sending") || (Date.parse(p.cooldownUntil || "") || 0) > Date.now()) });
      await flushPersist(() => useAppStore.getState());
    });
  }
}
