/**
 * 统一持久化入口：
 * - Tauri 桌面壳 → SQLite（rusqlite，本机 app_data/wap-plus.db）
 * - 浏览器预览 → IndexedDB（+ localStorage 备份）
 *
 * 首次在 Tauri 打开时，若 SQLite 为空会尝试从 IndexedDB 迁移。
 */

import {
  clearAppState as idbClear,
  loadAppState as idbLoad,
  saveAppState as idbSave,
} from "@/lib/idb";
import { isTauri } from "@/lib/bridge";

export type StorageEngine = "sqlite" | "idb" | "none";

let engine: StorageEngine = "none";
let engineResolved = false;
let engineResolvePromise: Promise<StorageEngine> | null = null;

/** 上次成功落盘的重量缓存，避免每次 save 前全量 db_load */
let lastSavedWeight = 0;
let lastSavedMsgCount = 0;
let lastSavedChatCount = 0;
let lastSavedContactCount = 0;

async function tryInvoke<T>(
  cmd: string,
  args?: Record<string, unknown>
): Promise<T | null> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<T>(cmd, args);
  } catch {
    return null;
  }
}

/** Tauri 的 Result<(), _> 会解析为 null，不能拿返回值判断是否成功。 */
async function tryInvokeOk(
  cmd: string,
  args?: Record<string, unknown>
): Promise<boolean> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke(cmd, args);
    return true;
  } catch (error) {
    console.error(
      `[ipc] ${cmd} failed:`,
      error instanceof Error ? error.message : error
    );
    return false;
  }
}

export function getStorageEngine(): StorageEngine {
  return engine;
}

export async function resolveStorageEngine(): Promise<StorageEngine> {
  if (engineResolved) return engine;
  if (!engineResolvePromise) {
    engineResolvePromise = tryInvoke<{ engine?: string }>("db_info").then(
      (info) => {
        // 桌面版探测失败也不能降级到 IndexedDB：那会把写入放到另一套库，
        // 下一次启动从 SQLite 读取时，用户刚保存的数据就像消失了一样。
        engine = info?.engine === "sqlite" || isTauri() ? "sqlite" : "idb";
        engineResolved = true;
        return engine;
      }
    );
  }
  return engineResolvePromise;
}

/** 前端 PersistSlice 形状（与 store 对齐） */
export type PersistDirtyFlags = {
  phones?: boolean;
  contacts?: boolean;
  chats?: boolean;
  messages?: boolean;
  followUps?: boolean;
  activities?: boolean;
  settings?: boolean;
  broadcastCampaigns?: boolean;
};

export interface PersistedAppState {
  phones: unknown[];
  contacts: unknown[];
  chats: unknown[];
  messages: unknown[];
  /** 完整内存消息数；增量 messages 不能用于判断整库是否被清空。 */
  messageCount?: number;
  followUps: unknown[];
  activities?: unknown[];
  settings: unknown;
  /** 克制群发战役（与 store 对齐；SQLite 经 settings 旁路键或顶层字段） */
  broadcastCampaigns?: unknown[];
  /** 表级脏标记：SQLite save 可跳过未脏表 */
  dirty?: PersistDirtyFlags;
  /** SQLite 增量保存时需要真正删除的消息。 */
  deletedMessageIds?: string[];
  /** 备份恢复等完整快照：消息表以本次快照为准。 */
  replaceMessages?: boolean;
}

/** Rust AppSnapshot 使用 followUps 字段名 follow_ups */
interface RustSnapshot {
  phones: unknown[];
  contacts: unknown[];
  chats: unknown[];
  messages: unknown[];
  followUps?: unknown[];
  follow_ups?: unknown[];
  activities: unknown[];
  settings: unknown;
  broadcastCampaigns?: unknown[];
  broadcast_campaigns?: unknown[];
  deletedMessageIds?: string[];
  deleted_message_ids?: string[];
  replaceMessages?: boolean;
  replace_messages?: boolean;
}

function toRust(data: PersistedAppState): Record<string, unknown> {
  // camelCase — 与 Rust #[serde(rename_all = "camelCase")] 对齐
  // broadcastCampaigns：顶层 + 嵌入 settings.__broadcastCampaigns 双写，兼容旧 load 只读 settings
  const d = data.dirty;
  const includeSettings = !d || d.settings || d.broadcastCampaigns;
  const settingsObj =
    includeSettings && data.settings && typeof data.settings === "object"
      ? { ...(data.settings as Record<string, unknown>) }
      : {};
  if (includeSettings && data.broadcastCampaigns) {
    settingsObj.__broadcastCampaigns = data.broadcastCampaigns;
  }
  const include = (key: keyof PersistDirtyFlags) => !d || d[key];
  return {
    phones: include("phones") ? data.phones ?? [] : [],
    contacts: include("contacts") ? data.contacts ?? [] : [],
    chats: include("chats") ? data.chats ?? [] : [],
    messages: include("messages") ? data.messages ?? [] : [],
    followUps: include("followUps") ? data.followUps ?? [] : [],
    activities: include("activities") ? data.activities ?? [] : [],
    settings: settingsObj,
    broadcastCampaigns: include("broadcastCampaigns")
      ? data.broadcastCampaigns ?? []
      : [],
    deletedMessageIds: data.deletedMessageIds ?? [],
    replaceMessages: data.replaceMessages === true,
    dirty: d
      ? {
          phones: !!d.phones,
          contacts: !!d.contacts,
          chats: !!d.chats,
          messages: !!d.messages,
          followUps: !!d.followUps,
          activities: !!d.activities,
          settings: !!d.settings || !!d.broadcastCampaigns,
          // 注意：不能反向传染——仅改设置项的保存不得把战役标记为脏，
          // 否则 delta 快照顶层会携带空数组，Rust 端会用它覆盖
          // settings.__broadcastCampaigns 里嵌入的真实群发战役（数据丢失）。
          // 战役改动仍会通过下一行的 settings 正向传染完整重写设置。
          broadcastCampaigns: !!d.broadcastCampaigns,
        }
      : undefined,
  };
}

function fromRust(snap: RustSnapshot): PersistedAppState {
  const settings = snap.settings ?? {};
  const fromTop =
    snap.broadcastCampaigns ?? snap.broadcast_campaigns ?? undefined;
  const fromSettings =
    settings &&
    typeof settings === "object" &&
    settings !== null &&
    "__broadcastCampaigns" in (settings as object)
      ? (settings as { __broadcastCampaigns?: unknown }).__broadcastCampaigns
      : undefined;
  // 读出后去掉 settings 内旁路键，避免污染 AppSettings 类型
  let settingsClean = settings;
  if (
    settings &&
    typeof settings === "object" &&
    settings !== null &&
    "__broadcastCampaigns" in (settings as object)
  ) {
    const { __broadcastCampaigns: _drop, ...rest } = settings as Record<
      string,
      unknown
    >;
    settingsClean = rest;
  }
  return {
    phones: snap.phones ?? [],
    contacts: snap.contacts ?? [],
    chats: snap.chats ?? [],
    messages: snap.messages ?? [],
    followUps: snap.followUps ?? snap.follow_ups ?? [],
    activities: snap.activities ?? [],
    settings: settingsClean,
    broadcastCampaigns: (fromTop ?? fromSettings ?? []) as unknown[],
  };
}

export async function loadAppState<T = PersistedAppState>(): Promise<T | null> {
  const started = performance.now();
  const eng = await resolveStorageEngine();

  if (eng === "sqlite") {
    // 只有成功读取的 null 才表示空库；IPC/数据库错误必须阻止 hydrate。
    const { invoke } = await import("@tauri-apps/api/core");
    const snap = await invoke<RustSnapshot | null>("db_load");
    if (snap) {
      const data = fromRust(snap);
      rememberSavedWeight(data);
      console.info(
        `[startup] storage ${(performance.now() - started).toFixed(0)}ms engine=sqlite messages=${data.messages?.length ?? 0}`
      );
      return data as T;
    }
    // SQLite 空：尝试从 IDB 迁移一次
    const fromIdb = await idbLoad<PersistedAppState>();
    if (fromIdb && (fromIdb.contacts?.length || fromIdb.phones?.length)) {
      const saved = await tryInvokeOk("db_save", {
        snapshot: toRust(fromIdb),
      });
      if (!saved) throw new Error("IndexedDB 数据迁移到 SQLite 失败，请重试");
      console.info("[storage] migrated IndexedDB → SQLite");
      rememberSavedWeight(fromIdb);
      console.info(
        `[startup] storage ${(performance.now() - started).toFixed(0)}ms engine=sqlite-migrated messages=${fromIdb.messages?.length ?? 0}`
      );
      return fromIdb as T;
    }
    return null;
  }

  const idb = await idbLoad<T>();
  if (idb && typeof idb === "object") {
    rememberSavedWeight(idb as unknown as PersistedAppState);
  }
  console.info(
    `[startup] storage ${(performance.now() - started).toFixed(0)}ms engine=idb messages=${(idb as PersistedAppState | null)?.messages?.length ?? 0}`
  );
  return idb;
}

function stateWeight(data: Partial<PersistedAppState> | null | undefined) {
  if (!data) return 0;
  return (
    (data.contacts?.length || 0) +
    (data.chats?.length || 0) +
    (data.messageCount ?? data.messages?.length ?? 0) +
    (data.phones?.length || 0)
  );
}

function rememberSavedWeight(data: PersistedAppState) {
  lastSavedWeight = stateWeight(data);
  lastSavedMsgCount = data.messageCount ?? data.messages?.length ?? 0;
  lastSavedChatCount = data.chats?.length || 0;
  lastSavedContactCount = data.contacts?.length || 0;
}

/**
 * 防止空/半空状态把磁盘上的完整 CRM 整库盖掉。
 * 用户清空数据时传 force:true。
 * 防护优先用「上次成功写入」缓存，避免每次 save 全量 db_load（大库极重）。
 */
let saveQueue: Promise<void> = Promise.resolve();

async function saveAppStateNow(
  data: PersistedAppState,
  opts?: { force?: boolean }
): Promise<void> {
  const eng = await resolveStorageEngine();
  const incoming = stateWeight(data);

  if (!opts?.force) {
    try {
      // 有缓存：O(1) 防护；无缓存才读盘一次并写入缓存
      let prevW = lastSavedWeight;
      let prevMsg = lastSavedMsgCount;
      let prevChat = lastSavedChatCount;
      let prevContact = lastSavedContactCount;

      if (prevW <= 0) {
        const existing =
          eng === "sqlite"
            ? await tryInvoke<RustSnapshot | null>("db_load")
            : await idbLoad<PersistedAppState>();
        const prev = existing
          ? eng === "sqlite"
            ? fromRust(existing as RustSnapshot)
            : (existing as PersistedAppState)
          : null;
        if (prev) {
          rememberSavedWeight(prev);
          prevW = lastSavedWeight;
          prevMsg = lastSavedMsgCount;
          prevChat = lastSavedChatCount;
          prevContact = lastSavedContactCount;
        }
      }

      if (incoming === 0 && prevW > 0) {
        console.warn(
          "[storage] blocked empty saveAppState that would wipe CRM data"
        );
        // 仅 settings：仍需读盘合并（极少路径）
        try {
          const existing =
            eng === "sqlite"
              ? await tryInvoke<RustSnapshot | null>("db_load")
              : await idbLoad<PersistedAppState>();
          const prev = existing
            ? eng === "sqlite"
              ? fromRust(existing as RustSnapshot)
              : (existing as PersistedAppState)
            : null;
          if (data.settings && prev) {
            const merged: PersistedAppState = {
              ...prev,
              settings: data.settings,
            };
            if (eng === "sqlite") {
              const ok = await tryInvokeOk("db_save", {
                snapshot: toRust(merged),
              });
              if (!ok) throw new Error("SQLite 设置保存失败");
            } else {
              await idbSave(merged);
            }
            rememberSavedWeight(merged);
          }
        } catch {
          /* ignore */
        }
        return;
      }

      const msgCrash =
        (data.messageCount ?? data.messages?.length ?? 0) === 0 && prevMsg > 10 &&
        !(eng === "sqlite" && !data.replaceMessages && data.deletedMessageIds?.length);
      const chatCrash =
        (data.chats?.length || 0) === 0 && prevChat > 5;
      const contactCrash =
        (data.contacts?.length || 0) === 0 && prevContact > 5;
      if (
        prevW >= 20 &&
        incoming < Math.max(5, Math.floor(prevW * 0.1)) &&
        (msgCrash || chatCrash || contactCrash)
      ) {
        console.warn("[storage] blocked suspicious wipe save", {
          incoming,
          prevW,
          msgCrash,
          chatCrash,
          contactCrash,
        });
        return;
      }
    } catch {
      /* ignore guard errors */
    }
  }

if (eng === "sqlite") {
    const messages = data.messages ?? [];
    // 消息量过大时单次 IPC/事务会卡死（138K 条 ≈ 百 MB + 全量 FTS）。
    // 分块 upsert（仅普通保存；备份恢复 replace 语义保持单次全量）。
    const MESSAGE_CHUNK = 1500;
    if (messages.length > MESSAGE_CHUNK && !data.replaceMessages) {
      const head: PersistedAppState = {
        ...data,
        messages: [],
        replaceMessages: false,
      };
      if (!(await tryInvokeOk("db_save", { snapshot: toRust(head) }))) {
        throw new Error("SQLite 数据保存失败");
      }
      for (let i = 0; i < messages.length; i += MESSAGE_CHUNK) {
        const part: PersistedAppState = {
          ...data,
          messages: messages.slice(i, i + MESSAGE_CHUNK),
          replaceMessages: false,
        };
        if (!(await tryInvokeOk("db_save", { snapshot: toRust(part) }))) {
          throw new Error("SQLite 数据保存失败");
        }
      }
      rememberSavedWeight(data);
      return;
    }
    const ok = await tryInvokeOk("db_save", { snapshot: toRust(data) });
    if (!ok) throw new Error("SQLite 数据保存失败");
    rememberSavedWeight(data);
    return;
  }

  await idbSave(data);
  rememberSavedWeight(data);
}

export type SecureSecrets = {
  openaiKey: string;
  groqKey: string;
  geminiKey: string;
  deepseekKey: string;
  qwenKey: string;
  zhipuKey: string;
  openrouterKey: string;
  customAiKey: string;
  bridgeToken: string;
};

export async function loadSecureSecrets(): Promise<SecureSecrets | null> {
  const secrets = await tryInvoke<{
    openai_key?: string;
    groq_key?: string;
    gemini_key?: string;
    deepseek_key?: string;
    qwen_key?: string;
    zhipu_key?: string;
    openrouter_key?: string;
    custom_ai_key?: string;
    bridge_token?: string;
  }>("secure_load_secrets");
  return secrets
    ? {
        openaiKey: secrets.openai_key || "",
        groqKey: secrets.groq_key || "",
        geminiKey: secrets.gemini_key || "",
        deepseekKey: secrets.deepseek_key || "",
        qwenKey: secrets.qwen_key || "",
        zhipuKey: secrets.zhipu_key || "",
        openrouterKey: secrets.openrouter_key || "",
        customAiKey: secrets.custom_ai_key || "",
        bridgeToken: secrets.bridge_token || "",
      }
    : null;
}

export async function saveSecureSecrets(
  secrets: SecureSecrets
): Promise<boolean> {
  return tryInvokeOk("secure_save_secrets", {
    secrets: {
      openai_key: secrets.openaiKey,
      groq_key: secrets.groqKey,
      gemini_key: secrets.geminiKey,
      deepseek_key: secrets.deepseekKey,
      qwen_key: secrets.qwenKey,
      zhipu_key: secrets.zhipuKey,
      openrouter_key: secrets.openrouterKey,
      custom_ai_key: secrets.customAiKey,
      bridge_token: secrets.bridgeToken,
    },
  });
}

export function saveAppState(
  data: PersistedAppState,
  opts?: { force?: boolean }
): Promise<void> {
  const run = saveQueue.then(() => saveAppStateNow(data, opts));
  saveQueue = run.catch(() => undefined);
  return run;
}

export function waitForPendingSaves(): Promise<void> {
  return saveQueue;
}

async function clearAppStateNow(): Promise<void> {
  const eng = await resolveStorageEngine();
  if (eng === "sqlite") {
    await tryInvoke("db_clear");
  }
  await idbClear();
  lastSavedWeight = 0;
  lastSavedMsgCount = 0;
  lastSavedChatCount = 0;
  lastSavedContactCount = 0;
}

export function clearAppState(): Promise<void> {
  const run = saveQueue.then(() => clearAppStateNow());
  saveQueue = run.catch(() => undefined);
  return run;
}

/** 清空某个仍保留会话的完整 SQLite 历史；IDB 由随后状态保存覆盖。 */
export function clearStoredChatMessages(chatId: string): Promise<void> {
  const run = saveQueue.then(async () => {
    const eng = await resolveStorageEngine();
    if (eng !== "sqlite") return;
    const ok = await tryInvokeOk("db_clear_chat_messages", { chatId });
    if (!ok) throw new Error("SQLite 聊天记录清空失败");
  });
  saveQueue = run.catch(() => undefined);
  return run;
}

/** WhatsApp 远端“清空聊天”按 JID 清掉未加载进内存的冷历史。 */
export function clearStoredRemoteMessages(
  remoteJid: string,
  accountId?: string
): Promise<void> {
  const run = saveQueue.then(async () => {
    const eng = await resolveStorageEngine();
    if (eng !== "sqlite") return;
    const ok = await tryInvokeOk("db_clear_remote_messages", {
      remoteJid,
      accountId: accountId || null,
    });
    if (!ok) throw new Error("SQLite 远端聊天记录清空失败");
  });
  saveQueue = run.catch(() => undefined);
  return run;
}

/** 删除未加载进内存的协议消息，兼容本地 id、waMessageId 和 waKey.id。 */
export function deleteStoredMessagesByKeys(
  keys: string[],
  accountId?: string
): Promise<void> {
  const unique = [...new Set(keys.map((key) => key.trim()).filter(Boolean))];
  if (!unique.length) return Promise.resolve();
  const run = saveQueue.then(async () => {
    const eng = await resolveStorageEngine();
    if (eng !== "sqlite") return;
    const ok = await tryInvokeOk("db_delete_messages_by_keys", {
      keys: unique,
      accountId: accountId || null,
    });
    if (!ok) throw new Error("SQLite 消息删除落盘失败");
  });
  saveQueue = run.catch(() => undefined);
  return run;
}

export async function getDbInfo(): Promise<Record<string, unknown> | null> {
  const eng = await resolveStorageEngine();
  if (eng !== "sqlite") {
    return { engine: "idb", note: "浏览器预览使用 IndexedDB" };
  }
  return tryInvoke<Record<string, unknown>>("db_info");
}

export type FullHistoryResult = {
  messages: unknown[];
  activities: unknown[];
};

/** 桌面版完整备份使用；浏览器 IDB 本身就是完整内存快照。 */
export async function loadFullHistory(): Promise<FullHistoryResult | null> {
  const eng = await resolveStorageEngine();
  if (eng !== "sqlite") return null;
  return tryInvoke<FullHistoryResult>("db_load_full_history");
}

export type MessagesPageResult = {
  ok: boolean;
  chatId: string;
  items: unknown[];
  total: number;
  limit: number;
};

/** SQLite 冷历史分页；浏览器 IDB 无分页时返回 null */
export async function loadMessagesPage(opts: {
  chatId: string;
  beforeSentAt?: string | null;
  beforeId?: string | null;
  limit?: number;
}): Promise<MessagesPageResult | null> {
  const eng = await resolveStorageEngine();
  if (eng !== "sqlite") return null;
  return tryInvoke<MessagesPageResult>("db_load_messages_page", {
    chatId: opts.chatId,
    beforeSentAt: opts.beforeSentAt ?? null,
    beforeId: opts.beforeId ?? null,
    limit: opts.limit ?? 80,
  });
}

export type SearchMessagesResult = {
  ok: boolean;
  query: string;
  items: unknown[];
  limit: number;
};

/** 全局消息搜索（SQLite 含冷历史）；浏览器返回 null 由前端扫内存 */
export async function searchMessagesInDb(opts: {
  query: string;
  limit?: number;
}): Promise<SearchMessagesResult | null> {
  const eng = await resolveStorageEngine();
  if (eng !== "sqlite") return null;
  return tryInvoke<SearchMessagesResult>("db_search_messages", {
    query: opts.query,
    limit: opts.limit ?? 40,
  });
}

export async function getMessageFromDb(
  id: string
): Promise<unknown | null> {
  const eng = await resolveStorageEngine();
  if (eng !== "sqlite" || !id) return null;
  const res = await tryInvoke<{ ok?: boolean; item?: unknown | null }>(
    "db_get_message",
    { id }
  );
  return res?.item ?? null;
}
