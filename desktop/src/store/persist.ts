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
import { deferDuringRestore, isDataRestoreActive } from "./restoreGuard";
import { diffMessageRows } from "./messagePersistDelta";
import { assertChatDraftCapacity } from "@/lib/chatDrafts";

/** SQLite 增量保存，IDB 保存完整快照。UI 交互用防抖；退出前可 flushPersist。 */
let persistTimer: ReturnType<typeof setTimeout> | null = null;
/** 交互中加长防抖，减少拖窗/点按钮时的磁盘争用 */
const PERSIST_DEBOUNCE_MS = 1400;
const COMPOSER_RETRY_MS = 300;
let statsTimer: ReturnType<typeof setTimeout> | null = null;
let statsIdle: number | null = null;
let lastPersistErrorAt = 0;
let lastDraftErrorAt = 0;

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
  | "draftReplyByChatId"
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
  drafts: true,
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
  drafts: false,
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
  draftReplyByChatId: state.draftReplyByChatId,
});

function markDirty(state: AppState) {
  if (!persistedRefs) {
    pendingDirty = allDirty();
    return;
  }
  for (const key of Object.keys(pendingDirty) as (keyof PersistDirtyFlags)[]) {
    const stateKey = key === "drafts" ? "draftReplyByChatId" : key;
    if (state[stateKey] !== persistedRefs[stateKey]) pendingDirty[key] = true;
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
  let drafts: AppState["draftReplyByChatId"] | undefined = s.draftReplyByChatId;
  try { assertChatDraftCapacity(drafts || {}); }
  catch (error) {
    // 超限草稿留在内存，保留磁盘旧稿；不能阻断消息/联系人等其它数据保存。
    drafts = undefined;
    dirty = { ...(dirty || allDirty()), drafts: false };
    if (Date.now() - lastDraftErrorAt > 10_000) {
      lastDraftErrorAt = Date.now();
      s.pushToast(error instanceof Error ? error.message : "草稿未保存", "error");
    }
  }
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
    draftReplyByChatId: drafts,
    dirty,
    deletedMessageIds,
  };
}

export function persist(
  get: () => AppState,
  immediate = false,
  debounceMs = PERSIST_DEBOUNCE_MS
): Promise<void> | undefined {
  if (isDataRestoreActive()) {
    return new Promise<void>((resolve, reject) => {
      deferDuringRestore(() => {
        Promise.resolve(persist(get, immediate, debounceMs)).then(resolve, reject);
      });
    });
  }
  // hydrate 前禁止写盘，防止空白初始 state 覆盖本地库
  if (!get().hydrated) return;
  const state = get();
  markDirty(state);
  if (immediate) {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    const dirty = persistedRefs ? pendingDirty : allDirty();
    const messageDelta = dirty.messages && persistedRefs
      ? diffMessageRows(persistedRefs.messages, state.messages)
      : undefined;
    persistedRefs = captureRefs(state);
    pendingDirty = noDirty();
    const savePromise = saveAppState(
      buildPersistSlice(
        () => state,
        dirty,
        messageDelta?.changedRows,
        messageDelta?.deletedIds
      )
    );
    void savePromise.catch((error) => reportPersistError(get, error));
    return savePromise;
  }
  if (persistTimer) clearTimeout(persistTimer);
  const run = () => {
    if (isComposerTypingBusy(Date.now())) {
      persistTimer = setTimeout(run, COMPOSER_RETRY_MS);
      return;
    }
    persistTimer = null;
    if (deferDuringRestore(() => { void persist(get); })) return;
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
  return persist(get, true) || Promise.resolve();
}

/** 连续输入也定期保存；SQLite 只写轻量草稿行，不准备消息增量。 */
export function persistChatDrafts(get: () => AppState): Promise<void> {
  if (!get().hydrated || isDataRestoreActive()) return Promise.resolve();
  if (getStorageEngine() !== "sqlite") return flushPersist(get);
  const promise = saveAppState(buildPersistSlice(get, { ...noDirty(), drafts: true }));
  void promise.catch(error => reportPersistError(get, error));
  return promise;
}

export function accountCreatedAtOf(settings: AppSettings, accountId: string): string | null {
  const acc = settings.waAccounts.find((a) => a.id === accountId);
  if (acc?.warmupExempt) return null;
  if (acc?.createdAt) return acc.createdAt;
  return null;
}
