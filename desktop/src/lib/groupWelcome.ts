import type { BridgeEvent } from "./bridge";
import type { AppState } from "@/store/types";
import type { ScheduledMessage } from "@/types/crm";

export const GROUP_WELCOME_LIVE_WINDOW = 5 * 60_000;
const PREFIX = "group-welcome:";
const MAX_GROUP_WELCOME_TASKS = 200;
export const groupWelcomePendingWrites = new Set<string>();
export const groupWelcomeKey = (accountId: string, jid: string) => JSON.stringify([accountId, jid]);
export const isGroupWelcomeTask = (id: string) => id.startsWith(PREFIX);
export type GroupWelcomeTemplate = string | { text: string; imageDataUrl: string };
export type GroupWelcomeRule = { enabled: boolean; templates: GroupWelcomeTemplate[] };

export const MAX_WELCOME_IMAGE_BYTES = 1024 * 1024;
export function normalizeWelcomeImage(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 4 * Math.ceil(MAX_WELCOME_IMAGE_BYTES / 3) + 32) return;
  const match = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[1].length % 4 !== 0) return;
  const padding = match[1].endsWith("==") ? 2 : match[1].endsWith("=") ? 1 : 0;
  if (match[1].length * 3 / 4 - padding <= MAX_WELCOME_IMAGE_BYTES) return value;
}

export function groupWelcomeBlockedStatus(settings: AppState["settings"], task: ScheduledMessage, now = Date.now()) {
  if (!isGroupWelcomeTask(task.id)) return;
  if (settings.sendChannel !== "baileys" ||
      !settings.groupWelcomeRules?.[groupWelcomeKey(task.accountId || "", task.recipient)]?.enabled) return "cancelled";
  const joinedAt = Date.parse(task.createdAt);
  if (!Number.isFinite(joinedAt) || now - joinedAt > GROUP_WELCOME_LIVE_WINDOW) return "expired";
}

export function normalizeWelcomeTemplates(values: unknown): GroupWelcomeTemplate[] {
  if (!Array.isArray(values)) return [];
  const versions = new Map<string, GroupWelcomeTemplate>();
  for (const value of values.slice(0, 20)) {
    const rawText = typeof value === "string" ? value : value?.text;
    const text = typeof rawText === "string" ? rawText.trim().slice(0, 4000) : "";
    const imageDataUrl = normalizeWelcomeImage(value?.imageDataUrl);
    if (imageDataUrl || text) versions.set(JSON.stringify([text, imageDataUrl]),
      imageDataUrl ? { text, imageDataUrl } : text);
  }
  return [...versions.values()];
}

export function normalizeGroupWelcomeRules(value: unknown): Record<string, GroupWelcomeRule> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(Object.entries(value).slice(0, 1000).flatMap(([key, rule]) => {
    if (!key.startsWith("[") || key.length > 400 || !rule || typeof rule !== "object") return [];
    const templates = normalizeWelcomeTemplates(rule.templates);
    return [[key, { enabled: rule.enabled === true && templates.length > 0, templates }]];
  }));
}

export function recentWelcomeEvents(value: unknown, now = Date.now()): Record<string, number> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(Object.entries(value).filter(([key, ts]) =>
    key.startsWith(PREFIX) && key.length < 650 && typeof ts === "number" &&
    Number.isFinite(ts) && ts >= now - GROUP_WELCOME_LIVE_WINDOW && ts <= now + 60_000
  ));
}

export function buildGroupWelcomeQueue(state: AppState, events: readonly BridgeEvent[], now = Date.now()) {
  const arrivals = events.filter(event => event.type === "messages.sync" &&
    (event.payload as { source?: string } | undefined)?.source === "group-welcome-live");
  if (!arrivals.length || !state.hydrated || state.settings.sendChannel !== "baileys") return;

  const seen = recentWelcomeEvents(state.settings.groupWelcomeSeen, now);
  const tasks = [...state.settings.scheduledMessages];
  const added: ScheduledMessage[] = [];
  let capacitySkipped = 0;
  let welcomeCount = tasks.filter(task => isGroupWelcomeTask(task.id)).length;
  for (const event of arrivals) {
    const payload = event.payload as { accountId?: string; groupJid?: string; messageId?: string; joinedAt?: number; live?: boolean };
    const { groupJid, messageId, joinedAt } = payload;
    const accountId = event.deviceId || payload.accountId;
    if (payload.live !== true || !accountId || !state.settings.waAccounts.some(account => account.id === accountId) ||
      typeof groupJid !== "string" || !/^\d+(?:-\d+)?@g\.us$/.test(groupJid) ||
      typeof messageId !== "string" || !messageId || messageId.length > 200 ||
      typeof joinedAt !== "number" || !Number.isFinite(joinedAt) || joinedAt < now - GROUP_WELCOME_LIVE_WINDOW || joinedAt > now + 60_000) continue;

    const key = groupWelcomeKey(accountId, groupJid);
    const id = PREFIX + JSON.stringify([key, messageId]);
    const rule = state.settings.groupWelcomeRules?.[key];
    if (!rule?.enabled || !rule.templates.length || Object.hasOwn(seen, id) || tasks.some(task => task.id === id)) continue;
    const contact = state.contacts.find(item => item.isGroup && item.channelAddress === groupJid &&
      (item.accountId || item.boundPhoneId) === accountId);
    const chat = contact && state.chats.find(item => item.contactId === contact.id &&
      (item.accountId || item.phoneId || contact.accountId || contact.boundPhoneId) === accountId);
    if (!contact || !chat) continue;
    if (welcomeCount >= MAX_GROUP_WELCOME_TASKS) {
      const completed = tasks.findIndex(task => isGroupWelcomeTask(task.id) &&
        ["sent", "failed", "expired", "cancelled"].includes(task.status));
      if (completed < 0) { capacitySkipped++; continue; }
      tasks.splice(completed, 1);
      welcomeCount--;
    }
    const time = new Date(now).toISOString();
    const template = rule.templates[Math.floor(Math.random() * rule.templates.length)]!;
    const task: ScheduledMessage = {
      id, accountId, chatId: chat.id, contactId: contact.id, contactName: contact.name,
      channelId: "baileys", recipient: groupJid,
      ...(typeof template === "string" ? { text: template } : template),
      status: "pending", dueAt: time, createdAt: new Date(joinedAt).toISOString(),
    };
    seen[id] = joinedAt;
    tasks.push(task);
    added.push(task);
    welcomeCount++;
  }
  if (added.length || capacitySkipped) return { tasks, seen, added, capacitySkipped };
}
