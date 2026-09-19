import {
  saveAppState,
  getStorageEngine,
  type PersistDirtyFlags,
} from "@/lib/storage";
import {
  stripHeavyContactMediaForPersist,
  stripHeavyMediaForPersist,
} from "@/lib/persistMedia";
import { isComposerTypingBusy } from "@/lib/composerActivity";
import { noteMainThreadWork } from "@/lib/syncDebug";
import type {
  AppState,
  AppSettings,
  PersistSlice,
} from "./types";
import { diffMessageRows } from "./messagePersistDelta";

/** SQLite 增量保存，IDB 保存完整快照。UI 交互用防抖；退出前可 flushPersist。 */
let persistTimer: ReturnType<typeof setTimeout> | null = null;
/** 交互中加长防抖，减少拖窗/点按钮时的磁盘争用 */
const PERSIST_DEBOUNCE_MS = 1400;
const COMPOSER_RETRY_MS = 300;
let statsTimer: ReturnType<typeof setTimeout> | null = null;
let statsIdle: number | null = null;
let lastPersistErrorAt = 0;

function reportPersistError(get: () => AppState, error: unknown) {
  console.error("[storage] save failed", error);
  // 下一次状态变化必须重试全量保存，不能把失败快照当成已落盘基线。
  persistedRefs = null;
  pendingDirty = allDirty();
  const now = Date.now();
  if (now - lastPersistErrorAt < 10_000) return;
  lastPersistErrorAt = now;
  get().pushToast("本地保存失败，请检查磁盘空间后重试", "error");
}

type PersistRefs = Pick<
  AppState,
  | "phones"
  | "contacts"
  | "chats"
  | "messages"
  | "followUps"
  | "activities"
  | "settings"
  | "broadcastCampaigns"
>;

const allDirty = (): PersistDirtyFlags => ({
  phones: true,
  contacts: true,
  chats: true,
  messages: true,
  followUps: true,
  activities: true,
  settings: true,
  broadcastCampaigns: true,
});
const noDirty = (): PersistDirtyFlags => ({
  phones: false,
  contacts: false,
  chats: false,
  messages: false,
  followUps: false,
  activities: false,
  settings: false,
  broadcastCampaigns: false,
});

let persistedRefs: PersistRefs | null = null;
let pendingDirty = noDirty();

const captureRefs = (state: AppState): PersistRefs => ({
  phones: state.phones,
  contacts: state.contacts,
  chats: state.chats,
  messages: state.messages,
  followUps: state.followUps,
  activities: state.activities,
  settings: state.settings,
  broadcastCampaigns: state.broadcastCampaigns,
});

function markDirty(state: AppState) {
  if (!persistedRefs) {
    pendingDirty = allDirty();
    return;
  }
  for (const key of Object.keys(pendingDirty) as (keyof PersistDirtyFlags)[]) {
    if (state[key] !== persistedRefs[key]) pendingDirty[key] = true;
  }
}

export function primePersistBaseline(get: () => AppState) {
  persistedRefs = captureRefs(get());
  pendingDirty = noDirty();
}

export function scheduleStatsRecompute(get: () => AppState) {
  if (statsTimer || statsIdle != null) return;
  const run = () => {
    statsTimer = null;
    statsIdle = null;
    if (isComposerTypingBusy(Date.now())) {
      statsTimer = setTimeout(run, COMPOSER_RETRY_MS);
      return;
    }
    const startedAt = performance.now();
    get().recomputeStats();
    noteMainThreadWork("stats recompute", startedAt);
  };
  if (typeof window.requestIdleCallback === "function") {
    statsIdle = window.requestIdleCallback(run, { timeout: 1500 });
  } else {
    statsTimer = setTimeout(run, 300);
  }
}

export function buildPersistSlice(
  get: () => AppState,
  dirty?: PersistDirtyFlags,
  messageRows?: AppState["messages"],
  deletedMessageIds?: string[]
): PersistSlice & {
  dirty?: PersistDirtyFlags;
  deletedMessageIds?: string[];
  messageCount: number;
} {
  const s = get();
  const sqlite = getStorageEngine() === "sqlite";
  // API Key 只保存在运行时和 Windows DPAPI，任何状态快照都不落明文。
  const settings = {
    ...s.settings,
    openaiKey: "",
    groqKey: "",
    geminiKey: "",
    deepseekKey: "",
    qwenKey: "",
    zhipuKey: "",
    openrouterKey: "",
    customAiKey: "",
    bridgeToken: "",
  };
  return {
    phones: s.phones,
    contacts:
      sqlite && dirty?.contacts === false
        ? s.contacts
        : stripHeavyContactMediaForPersist(s.contacts),
    chats: s.chats,
    messageCount: s.messages.length,
    messages:
      sqlite && dirty?.messages === false
        ? s.messages
        : stripHeavyMediaForPersist(sqlite ? messageRows ?? s.messages : s.messages),
    followUps: s.followUps,
    scheduledMessages: s.scheduledMessages,
    activities: s.activities.slice(0, 2000),
    settings,
    broadcastCampaigns: s.broadcastCampaigns,
    dirty,
    deletedMessageIds,
  };
}

export function persist(
  get: () => AppState,
  immediate = false,
  debounceMs = PERSIST_DEBOUNCE_MS
) {
  // hydrate 前禁止写盘，防止空白初始 state 覆盖本地库
  if (!get().hydrated) return;
  const state = get();
  markDirty(state);
  if (immediate) {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    const messageDelta = persistedRefs
      ? diffMessageRows(persistedRefs.messages, state.messages)
      : undefined;
    persistedRefs = captureRefs(state);
    pendingDirty = noDirty();
    void saveAppState(
      buildPersistSlice(
        () => state,
        allDirty(),
        state.messages,
        messageDelta?.deletedIds
      )
    ).catch((error) => reportPersistError(get, error));
    return;
  }
  if (persistTimer) clearTimeout(persistTimer);
  const run = () => {
    if (isComposerTypingBusy(Date.now())) {
      persistTimer = setTimeout(run, COMPOSER_RETRY_MS);
      return;
    }
    persistTimer = null;
    if (!get().hydrated) return;
    const startedAt = performance.now();
    const current = get();
    markDirty(current);
    const dirty = pendingDirty;
    if (!Object.values(dirty).some(Boolean)) return;
    const messageDelta =
      dirty.messages && persistedRefs
        ? diffMessageRows(persistedRefs.messages, current.messages)
        : undefined;
    pendingDirty = noDirty();
    persistedRefs = captureRefs(current);
    void saveAppState(
      buildPersistSlice(
        () => current,
        dirty,
        messageDelta?.changedRows,
        messageDelta?.deletedIds
      )
    ).catch((error) => reportPersistError(get, error));
    noteMainThreadWork("persist prepare", startedAt);
  };
  persistTimer = setTimeout(run, debounceMs);
}

/** 关键路径立即落盘（清空数据、导出前等） */
export function flushPersist(get: () => AppState) {
  persist(get, true);
}

export function accountCreatedAtOf(settings: AppSettings, accountId: string): string | null {
  const acc = settings.waAccounts.find((a) => a.id === accountId);
  if (acc?.warmupExempt) return null;
  if (acc?.createdAt) return acc.createdAt;
  return null;
}
