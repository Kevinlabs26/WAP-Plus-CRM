import { flushPersist, useAppStore } from "@/store/appStore";
import { translateCurrent } from "@/i18n";
import { isDataRestoreActive } from "@/store/restoreGuard";
import { MAX_SCHEDULED_PLANS, MAX_SCHEDULED_PLAN_ITEMS, MIN_SCHEDULED_GAP_SEC, MAX_PLAN_STEPS, planSteps, recipientKey, scheduledPlanTargets, scheduledMediaBytes, type ScheduledPlan } from "./scheduledPlans";

export class DuplicateScheduledPlanError extends Error {
  constructor(readonly planIds: string[], readonly count: number) { super(translateCurrent("planQueue.duplicates", { count })); }
}
export function duplicateScheduledPlans(input: Pick<ScheduledPlan, "text" | "media" | "steps" | "items" | "dueAt">, plans: ScheduledPlan[]) {
  const content = (p: typeof input) => JSON.stringify(planSteps(p).map(step => [step.text.trim(), step.media?.kind, step.media?.dataUrl]));
  const targets = new Set(input.items.map(i => recipientKey(i.accountId, i.recipient)));
  const signature = content(input);
  return plans.filter(p => !["done", "cancelled", "expired"].includes(p.status) && Math.abs(Date.parse(p.dueAt) - Date.parse(input.dueAt)) <= 86400_000 && content(p) === signature && p.items.some(i => ["pending", "sending", "unknown"].includes(i.status) && targets.has(recipientKey(i.accountId, i.recipient))));
}

export async function updateScheduledPlan(id: string, change: (plan: ScheduledPlan) => ScheduledPlan) {
  if (isDataRestoreActive()) throw new Error(translateCurrent("planQueue.restoring"));
  const state = useAppStore.getState();
  if (!(state.settings.scheduledPlans || []).some(plan => plan.id === id)) return;
  state.updateSettings({ scheduledPlans: state.settings.scheduledPlans.map(plan => plan.id === id ? change(plan) : plan) });
  await flushPersist(() => useAppStore.getState());
}

export async function prioritizeBatchTask(id: string) {
  if (isDataRestoreActive()) throw new Error(translateCurrent("planQueue.restoring"));
  const state=useAppStore.getState();const plans=state.settings.scheduledPlans||[],campaigns=state.broadcastCampaigns||[];
  const task=[...plans,...campaigns].find(p=>p.id===id);
  if(!task||task.items.some(i=>i.status==="sending"))return;
  const priority=Math.max(0,...[...plans,...campaigns].map(p=>p.priority||0))+1;
  if(plans.some(p=>p.id===id))await updateScheduledPlan(id,p=>({...p,priority}));
  else {useAppStore.setState({broadcastCampaigns:campaigns.map(c=>c.id===id?{...c,priority}:c)});await flushPersist(()=>useAppStore.getState());}
}

export async function saveScheduledPlan(input: Omit<ScheduledPlan, "id" | "createdAt" | "status">, startNow = false, confirmedDuplicates: string[] = []) {
  const state = useAppStore.getState();
  if (isDataRestoreActive() || !state.hydrated || !state.uiReady) throw new Error(translateCurrent("planQueue.restoring"));
  const plans = state.settings.scheduledPlans || [];
  if (!input.items.length || input.items.length > MAX_SCHEDULED_PLAN_ITEMS || plans.length >= MAX_SCHEDULED_PLANS) throw new Error(translateCurrent("planQueue.capacity"));
  const dueAt = startNow ? new Date().toISOString() : input.dueAt;
  if ((!startNow && (!Number.isFinite(Date.parse(dueAt)) || Date.parse(dueAt) <= Date.now())) || !Number.isFinite(input.gapSec) || input.gapSec < MIN_SCHEDULED_GAP_SEC || input.gapSec > 3600) throw new Error(translateCurrent("planQueue.invalidTime"));
  if ((!input.text.trim() && !input.media) || input.text.length > 4000 || input.mediaUnavailable) throw new Error(translateCurrent("planQueue.invalidContent"));
  const steps = planSteps(input);
  if (steps.length > MAX_PLAN_STEPS || steps.some(s => typeof s.text !== "string" || s.text.length > 4000 || !s.text.trim() && !s.media || s.gapSec !== undefined && (!Number.isFinite(s.gapSec) || s.gapSec < 20 || s.gapSec > 3600))) throw new Error(translateCurrent("planQueue.invalidContent"));
  if (input.endAt && (!Number.isFinite(Date.parse(input.endAt)) || Date.parse(input.endAt) <= Date.parse(dueAt))) throw new Error(translateCurrent("planQueue.invalidDeadline"));
  if (input.quietHours && (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.quietHours.start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.quietHours.end) || input.quietHours.start === input.quietHours.end)) throw new Error(translateCurrent("planQueue.invalidTime"));
  try { new Intl.DateTimeFormat("en", { timeZone: input.timeZone }); } catch { throw new Error(translateCurrent("planQueue.invalidTime")); }
  const sizes = steps.map(s => s.media ? scheduledMediaBytes(s.media) : 0);
  if (sizes.some(size => size > 8 * 1024 * 1024)) throw new Error(translateCurrent("settingsQuickReplies.mediaTooLarge"));
  if (plans.reduce((sum, plan) => sum + planSteps(plan).reduce((n, s) => n + (s.media?.size || 0), 0), sizes.reduce((a,b)=>a+b,0)) > 64 * 1024 * 1024) throw new Error(translateCurrent("quickLibrary.mediaCapacity"));
  const resolved = scheduledPlanTargets(state, input.items.map(item => item.chatId));
  if (resolved.length !== input.items.length || input.items.some(item => !resolved.some(target => target.chatId === item.chatId && target.accountId === item.accountId && target.recipient === item.recipient))) throw new Error(translateCurrent("planQueue.targetsChanged"));
  const duplicates = duplicateScheduledPlans({ ...input, dueAt }, plans).filter(p => !confirmedDuplicates.includes(p.id));
  // Include legacy text broadcasts; their media is cached separately and cannot be compared reliably.
  const oldDuplicates = (state.broadcastCampaigns || []).filter(c => ["draft", "running", "paused"].includes(c.status) && !c.media?.length && steps.length === 1 && !input.media && c.items.some(i => ["pending", "sending"].includes(i.status) && i.bodyRendered.trim() === input.text.trim() && resolved.some(target => recipientKey(target.accountId,target.recipient) === recipientKey(c.accountId,i.phoneE164))) && !confirmedDuplicates.includes(c.id));
  if (duplicates.length || oldDuplicates.length) throw new DuplicateScheduledPlanError([...duplicates, ...oldDuplicates].map(p => p.id), duplicates.length + oldDuplicates.length);
  const plan: ScheduledPlan = { ...input, dueAt, text: input.text.trim(), id: crypto.randomUUID(), createdAt: new Date().toISOString(), status: "pending",
    priority: 0, endAt: input.endAt || undefined,
    media: input.media ? { ...input.media, size: sizes[0] } : undefined,
    steps: input.steps?.map((s,index)=>({text:s.text.trim(),media:s.media ? {...s.media,size:sizes[index+1]} : undefined,gapSec:s.gapSec})),
    items: resolved.map(item => ({ ...item, stepIndex: 0 })) };
  state.updateSettings({ scheduledPlans: [...plans, plan] });
  try { await flushPersist(() => useAppStore.getState()); }
  catch (error) {
    useAppStore.getState().updateSettings({ scheduledPlans: useAppStore.getState().settings.scheduledPlans.filter(item => item.id !== plan.id) });
    throw error;
  }
  return plan.id;
}
