/**
 * 近 7 日消息趋势增量桶：ingest/出站时 bump，calcStats 优先读桶，避免每次全表扫 messages。
 */

import type { Message, StatsTrendDay } from "@/types/crm";
import { DEFAULT_ACCOUNT_ID } from "@/types/account";
import { toLocalDayKey } from "./calcStats";

type DayBucket = {
  inbound: number;
  outbound: number;
  chats: Set<string>;
};

const buckets = new Map<string, DayBucket>();
const accountBuckets = new Map<string, Map<string, DayBucket>>();
let seededRef: unknown = null;

function localDayKey(d = new Date()): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

function dayKeys7(now = new Date()): string[] {
  const out: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const dt = new Date(now);
    dt.setHours(12, 0, 0, 0);
    dt.setDate(dt.getDate() - i);
    out.push(localDayKey(dt));
  }
  return out;
}

function touchIn(target: Map<string, DayBucket>, day: string): DayBucket {
  let b = target.get(day);
  if (!b) {
    b = { inbound: 0, outbound: 0, chats: new Set() };
    target.set(day, b);
  }
  return b;
}

function touch(day: string): DayBucket {
  return touchIn(buckets, day);
}

function pruneOldIn(target: Map<string, DayBucket>, oldest: string) {
  for (const k of [...target.keys()]) {
    if (k < oldest) target.delete(k);
  }
}

function pruneOld(oldest: string) {
  pruneOldIn(buckets, oldest);
  for (const target of accountBuckets.values()) pruneOldIn(target, oldest);
}

function accountIdOf(m: { accountId?: string; deviceId?: string | null }) {
  return String(m.accountId || m.deviceId || DEFAULT_ACCOUNT_ID).trim();
}

function accountTarget(accountId: string) {
  let target = accountBuckets.get(accountId);
  if (!target) {
    target = new Map();
    accountBuckets.set(accountId, target);
  }
  return target;
}

/** 单条消息入趋势（幂等不保证；重复 ingest 可能轻微高估，可 force reseed） */
export function noteTrendMessage(m: {
  direction?: string;
  sentAt?: string;
  chatId?: string;
  accountId?: string;
  deviceId?: string | null;
}) {
  const day = toLocalDayKey(m.sentAt || "");
  if (!day) return;
  const keys = dayKeys7();
  const oldest = keys[0];
  const today = keys[keys.length - 1];
  if (day < oldest || day > today) return;
  pruneOld(oldest);
  const b = touch(day);
  if (m.direction === "out") b.outbound += 1;
  else b.inbound += 1;
  if (m.chatId) b.chats.add(m.chatId);
  const accountId = accountIdOf(m);
  if (accountId) {
    const account = touchIn(accountTarget(accountId), day);
    if (m.direction === "out") account.outbound += 1;
    else account.inbound += 1;
    if (m.chatId) account.chats.add(m.chatId);
  }
}

export function noteTrendMessages(
  list: { direction?: string; sentAt?: string; chatId?: string }[]
) {
  for (const m of list) noteTrendMessage(m);
}

/** 从全量 messages 重建 7 日桶（hydrate / 强制） */
export function seedTrendFromMessages(messages: Message[], force = false) {
  if (!force && seededRef === messages) return;
  seededRef = messages;
  buckets.clear();
  accountBuckets.clear();
  const keys = dayKeys7();
  const oldest = keys[0];
  const today = keys[keys.length - 1];
  for (const day of keys) touch(day);
  for (const m of messages) {
    const day = toLocalDayKey(m.sentAt || "");
    if (!day || day < oldest || day > today) continue;
    const b = touch(day);
    if (m.direction === "out") b.outbound += 1;
    else b.inbound += 1;
    if (m.chatId) b.chats.add(m.chatId);
    const accountId = accountIdOf(m);
    if (accountId) {
      const account = touchIn(accountTarget(accountId), day);
      if (m.direction === "out") account.outbound += 1;
      else account.inbound += 1;
      if (m.chatId) account.chats.add(m.chatId);
    }
  }
}

export function readTrend7d(
  now = new Date(),
  accountId?: string
): StatsTrendDay[] | null {
  if (buckets.size === 0) return null;
  const keys = dayKeys7(now);
  pruneOld(keys[0]);
  const target = accountId ? accountBuckets.get(accountId) : buckets;
  return keys.map((day) => {
    const b = target?.get(day);
    return {
      day,
      activeChats: b?.chats.size ?? 0,
      inbound: b?.inbound ?? 0,
      outbound: b?.outbound ?? 0,
    };
  });
}

export function clearTrendBuckets() {
  buckets.clear();
  accountBuckets.clear();
  seededRef = null;
}
