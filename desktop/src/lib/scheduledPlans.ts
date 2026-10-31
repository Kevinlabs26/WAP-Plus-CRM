import type { ChatPreview, Contact } from "../types/crm";
import type { SettingsShape, SettingsQuickReply } from "../store/settingsDefaults";
import { resolveSendTarget } from "./utils";
import { MAX_QUICK_REPLY_MEDIA_BYTES } from "./quickReplies";
import type { BroadcastCampaign } from "../types/broadcast";

export type ScheduledPlanItem = {
  id: string; chatId: string; contactId: string; contactName: string; recipient: string; accountId: string;
  status: "pending" | "sending" | "sent" | "failed" | "unknown" | "cancelled";
  messageId?: string; error?: string; sentAt?: string;
  retired?: boolean;
  stepIndex?: number;
  messageIds?: string[];
  sequenceActivityAt?: string;
};
export type ScheduledPlanStep = { text: string; media?: SettingsQuickReply["media"]; gapSec?: number };
export type ScheduledPlan = {
  id: string; title: string; text: string; media?: SettingsQuickReply["media"];
  mediaUnavailable?: boolean;
  dueAt: string; timeZone: string; createdAt: string; gapSec: number;
  status: "pending" | "running" | "paused" | "expired" | "done" | "cancelled";
  startedAt?: string; offlineSince?: string; nextAttemptAt?: string; cooldownUntil?: string; error?: string; items: ScheduledPlanItem[];
  steps?: ScheduledPlanStep[];
  priority?: number;
  endAt?: string;
  quietHours?: { start: string; end: string };
  nativeMedia?: boolean;
};
export const MAX_PLAN_STEPS = 20;
export const planSteps = (plan: Pick<ScheduledPlan, "text" | "media" | "steps">): ScheduledPlanStep[] => [{ text: plan.text, media: plan.media }, ...(plan.steps || [])];
export const activePlanStep = (plan: ScheduledPlan, item: ScheduledPlanItem) => planSteps(plan)[item.stepIndex || 0];
export const recipientKey = (account: string, recipient: string) => `${account}:${resolveSendTarget({ phone: recipient, channelAddress: recipient }).replace(/^\+/, "")}`;
export function inQuietHours(plan: Pick<ScheduledPlan, "quietHours" | "timeZone">, now = Date.now()) {
  if (!plan.quietHours) return false;
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: plan.timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
  const { start, end } = plan.quietHours;
  return start < end ? parts >= start && parts < end : parts >= start || parts < end;
}
type BatchTask = { priority?: number; dueAt?: string; startedAt?: string; createdAt: string; id: string; status?: string; steps?: ScheduledPlanStep[]; items?: { status: string; stepIndex?: number; sequenceActivityAt?: string }[] };
export function ownsBatchTurn(task: BatchTask) {
  return task.status === "running" && !!task.items?.some(item => item.status === "sending" ||
    item.status === "pending" && !!task.steps?.length && (item.stepIndex || 0) > 0 && item.stepIndex! < task.steps.length + 1);
}
export function batchTaskOrder(a: BatchTask, b: BatchTask) {
  // Priority changes take effect between recipients, never between their sequence steps.
  const sending = (p: BatchTask) => p.status === "running" && !!p.items?.some(i=>i.status==="sending");
  const activity = (p: BatchTask) => ownsBatchTurn(p) ? Math.max(0,...(p.items||[]).filter(i=>i.status==="pending"&&(i.stepIndex||0)>0).map(i=>Date.parse(i.sequenceActivityAt||"")||0)) : 0;
  return Number(sending(b)) - Number(sending(a)) || Number(ownsBatchTurn(b)) - Number(ownsBatchTurn(a)) || activity(b) - activity(a) || (b.priority || 0) - (a.priority || 0) || Date.parse(a.dueAt || a.startedAt || a.createdAt) - Date.parse(b.dueAt || b.startedAt || b.createdAt) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}
export function nextBatchTask(plans: ScheduledPlan[], campaigns: BroadcastCampaign[] = [], now = Date.now()) {
  return [...plans.filter(p => (p.status === "running" || p.status === "pending" && Date.parse(p.dueAt) <= now) && (ownsBatchTurn(p) && !p.offlineSince || !(Date.parse(p.nextAttemptAt || "") > now)) && !(p.endAt && Date.parse(p.endAt) <= now) && !inQuietHours(p, now)),
    ...campaigns.filter(c => c.status === "running")].sort(batchTaskOrder)[0]?.id;
}
export const MAX_SCHEDULED_PLANS = 100;
export const MAX_SCHEDULED_PLAN_ITEMS = 1000;
export const MIN_SCHEDULED_GAP_SEC = 20;
export const SCHEDULED_START_GRACE_MS = 15 * 60_000;

export function scheduledMediaBytes(media: SettingsQuickReply["media"]): number {
  if (!media || typeof media.dataUrl !== "string" || media.dataUrl.length > 12 * 1024 * 1024) return Infinity;
  const match = /^data:[^,]*;base64,([A-Za-z0-9+/]*={0,2})$/.exec(media.dataUrl);
  if (!match || match[1].length % 4 !== 0) return Infinity;
  return match[1].length / 4 * 3 - (match[1].endsWith("==") ? 2 : match[1].endsWith("=") ? 1 : 0);
}

type TargetState = { chats: ChatPreview[]; contacts: Contact[]; settings: Pick<SettingsShape, "waAccounts" | "liveBaileysAccountId" | "activeAccountId" | "chatFolders" | "chatFolderClones"> };

/** Resolve each existing thread through its owner, never the currently viewed account. */
export function scheduledPlanTargets(state: TargetState, chatIds?: string[]) {
  const contacts = new Map(state.contacts.map(contact => [contact.id, contact]));
  const selected = chatIds ? new Set(chatIds) : null;
  const seen = new Set<string>();
  const items: ScheduledPlanItem[] = [];
  for (const chat of state.chats) {
    if (selected && !selected.has(chat.id)) continue;
    const contact = contacts.get(chat.contactId);
    if (!contact) continue;
    const accountId = chat.accountId || contact.accountId || "wa-default";
    if (chat.accountId && contact.accountId && chat.accountId !== contact.accountId) continue;
    if (!state.settings.waAccounts.some(account => account.id === accountId)) continue;
    const recipient = resolveSendTarget({ phone: contact.phone, channelAddress: contact.channelAddress, entityId: contact.id });
    if (!recipient || (!/^\+?\d{7,15}$/.test(recipient) && !/^[\w.-]+@(g\.us|s\.whatsapp\.net|c\.us|lid)$/.test(recipient))) continue;
    const key = recipientKey(accountId, recipient);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ id: chat.id, chatId: chat.id, contactId: contact.id, contactName: contact.name || chat.contactName || recipient, recipient, accountId, status: "pending" });
  }
  return items;
}

export function scheduledFolderChatIds(settings: TargetState["settings"], folderId: string, includeChildren: boolean) {
  const root = settings.chatFolders.find(folder => folder.id === folderId);
  if (!root) return [];
  const scope = (folder: typeof root) => folder.scope?.type === "all" ? "all" : folder.scope?.accountId || settings.liveBaileysAccountId || settings.activeAccountId || "wa-default";
  const ids = new Set([folderId]);
  if (includeChildren) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const folder of settings.chatFolders) {
        if (!ids.has(folder.id) && folder.parentId && ids.has(folder.parentId) && scope(folder) === scope(root)) { ids.add(folder.id); changed = true; }
      }
    }
  }
  return [...new Set([
    ...settings.chatFolders.filter(folder => ids.has(folder.id)).flatMap(folder => folder.chatIds),
    ...settings.chatFolderClones.filter(clone => ids.has(clone.folderId)).map(clone => clone.sourceChatId),
  ])];
}

export function normalizeScheduledPlans(raw: unknown): ScheduledPlan[] {
  if (!Array.isArray(raw)) return [];
  let mediaBytes = 0;
  const planIds = new Set<string>();
  return raw.slice(0, MAX_SCHEDULED_PLANS).flatMap(value => {
    if (!value || typeof value !== "object") return [];
    const p = value as ScheduledPlan;
    if (typeof p.id !== "string" || !p.id || !Array.isArray(p.items)) return [];
    if (planIds.has(p.id)) return [];
    planIds.add(p.id);
    const seen = new Set<string>();
    const itemIds = new Set<string>();
    const items: ScheduledPlanItem[] = p.items.slice(0, MAX_SCHEDULED_PLAN_ITEMS).flatMap(item => {
      if (!item || [item.chatId, item.contactId, item.accountId, item.recipient].some(field => typeof field !== "string" || !field)) return [];
      if (!/^\+?\d{7,15}$/.test(item.recipient) && !/^[\w.-]+@(g\.us|s\.whatsapp\.net|c\.us|lid)$/.test(item.recipient)) return [];
      const key = recipientKey(item.accountId, item.recipient);
      const id = String(item.id || item.chatId);
      if (seen.has(key) || itemIds.has(id)) return [];
      itemIds.add(id);
      seen.add(key);
      const status = ["pending", "sent", "failed", "unknown", "cancelled"].includes(item.status) ? item.status : "unknown";
      return [{ id: String(item.id || item.chatId), chatId: item.chatId, contactId: item.contactId, accountId: item.accountId, recipient: item.recipient, retired: item.retired === true,
        contactName: String(item.contactName || "").slice(0, 120), status, error: item.status === "sending" ? "planQueue.interrupted" : item.error ? String(item.error).slice(0, 300) : undefined,
        messageId: item.messageId ? String(item.messageId) : undefined, sentAt: item.sentAt ? String(item.sentAt) : undefined,
        stepIndex: Number.isInteger(item.stepIndex) && item.stepIndex! >= 0 ? item.stepIndex : 0,
        sequenceActivityAt: Number.isFinite(Date.parse(item.sequenceActivityAt||"")) ? item.sequenceActivityAt : undefined,
        messageIds: Array.isArray(item.messageIds) ? item.messageIds.filter(id => typeof id === "string").slice(0, MAX_PLAN_STEPS) : undefined } as ScheduledPlanItem];
    });
    let status: ScheduledPlan["status"] = ["pending", "paused", "expired", "done", "cancelled"].includes(p.status) ? p.status : "paused";
    if (items.some(item => item.status === "unknown") && status !== "cancelled") status = "paused";
    if (!Number.isFinite(Date.parse(p.dueAt))) status = "expired";
    let media: ScheduledPlan["media"];
    if (p.media && typeof p.media.dataUrl === "string" && /^data:[^,]*;base64,/.test(p.media.dataUrl)) {
      const size = scheduledMediaBytes(p.media);
      if (Number.isFinite(size) && size <= MAX_QUICK_REPLY_MEDIA_BYTES && mediaBytes + size <= 64 * 1024 * 1024) {
        media = { dataUrl: p.media.dataUrl, fileName: String(p.media.fileName || "attachment").slice(0, 180), mimeType: String(p.media.mimeType || "application/octet-stream").slice(0, 120),
          kind: ["image", "audio", "video", "file"].includes(p.media.kind) ? p.media.kind : "file", size }; mediaBytes += size;
      } else { status = "paused"; }
    }
    const steps: ScheduledPlanStep[] = [];
    let invalidSteps = !!p.steps && (!Array.isArray(p.steps) || p.steps.length >= MAX_PLAN_STEPS) || p.items.some(item=>item?.stepIndex!==undefined&&(!Number.isInteger(item.stepIndex)||item.stepIndex<0||item.stepIndex>MAX_PLAN_STEPS));
    for (const step of (Array.isArray(p.steps) ? p.steps : []).slice(0, MAX_PLAN_STEPS - 1)) {
      if (!step || typeof step.text !== "string" || step.text.length > 4000 || !step.text.trim() && !step.media) { invalidSteps = true; continue; }
      let attachment: ScheduledPlanStep["media"];
      if (step.media) {
        const size = scheduledMediaBytes(step.media);
        if (!Number.isFinite(size) || size > MAX_QUICK_REPLY_MEDIA_BYTES || mediaBytes + size > 64 * 1024 * 1024) invalidSteps = true;
        else { attachment = { ...step.media, size }; mediaBytes += size; }
      }
      steps.push({ text: step.text, media: attachment, gapSec: Number.isFinite(step.gapSec) ? Math.max(20, Math.min(3600, step.gapSec!)) : undefined });
    }
    if (items.some(item => (item.stepIndex || 0) >= steps.length + 1 && item.status !== "sent")) invalidSteps = true;
    let mediaUnavailable = p.mediaUnavailable === true || !!p.media && !media || invalidSteps;
    if (mediaUnavailable && !["done", "cancelled"].includes(status)) status = "paused";
    const gap = Number(p.gapSec);
    const gapSec = Number.isFinite(gap) ? Math.max(MIN_SCHEDULED_GAP_SEC, Math.min(3600, gap)) : 30;
    const interrupted = p.items.some(item => item?.status === "sending");
    let timeZone = String(p.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone);
    try { new Intl.DateTimeFormat("en", { timeZone }); }
    catch { timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone; }
    const validClock = (s: unknown) => typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
    const quietHours = p.quietHours && validClock(p.quietHours.start) && validClock(p.quietHours.end) && p.quietHours.start !== p.quietHours.end ? { ...p.quietHours } : undefined;
    const invalidWindow = !!(p.quietHours && !quietHours || p.endAt && !Number.isFinite(Date.parse(p.endAt)));
    if (invalidWindow) {status = "paused";mediaUnavailable=true;}
    return [{ id: p.id, title: String(p.title || "").slice(0, 80), text: String(p.text || "").slice(0, 4000), media, mediaUnavailable,
      gapSec,
      steps: steps.length ? steps : undefined, nativeMedia: p.nativeMedia === true, priority: Number.isFinite(p.priority) ? p.priority : 0,
      endAt: p.endAt ? String(p.endAt) : undefined, quietHours,
      dueAt: String(p.dueAt || ""), timeZone, createdAt: String(p.createdAt || p.dueAt), status, items,
      startedAt: p.startedAt ? String(p.startedAt) : undefined, offlineSince: p.offlineSince ? String(p.offlineSince) : undefined,
      nextAttemptAt: p.nextAttemptAt ? String(p.nextAttemptAt) : undefined,
      cooldownUntil: interrupted ? new Date(Math.max(Date.parse(p.cooldownUntil || "") || 0, Date.now() + gapSec * 1000)).toISOString() : p.cooldownUntil ? String(p.cooldownUntil) : undefined,
      error: invalidWindow ? "planQueue.invalidTime" : mediaUnavailable ? "planQueue.mediaMissing" : p.status === "running" ? "planQueue.interrupted" : p.error ? String(p.error).slice(0, 300) : undefined,
    }];
  });
}

export function scheduledPlanOrder(a: ScheduledPlan, b: ScheduledPlan) {
  return batchTaskOrder(a, b);
}
