/**
 * IndexedDB 轻量封装 — 浏览器 / Tauri WebView 通用持久化
 * 表结构对齐 docs 中的 CRM 主实体（JSON 文档存储，便于演进）
 */

const DB_NAME = "wap-plus-crm";
const DB_VERSION = 1;
const STORE = "kv";
let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      db.onclose = () => {
        dbPromise = null;
      };
      resolve(db);
    };
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
  });
  return dbPromise;
}

export async function idbGet<T>(key: string, strict = false): Promise<T | undefined> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => reject(req.error);
    });
  } catch (error) {
    if (strict) throw error;
    return undefined;
  }
}

export async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function idbDel(key: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function idbDelPrefix(prefix: string): Promise<number> {
  const db = await openDb();
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    let removed = 0;
    const req = store.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return;
      if (typeof cursor.key === "string" && cursor.key.startsWith(prefix)) {
        cursor.delete();
        removed++;
      }
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => resolve(removed);
    tx.onerror = () => reject(tx.error);
  });
}

/** 媒体缓存键：media:<messageId> */
export const mediaCacheKey = (messageId: string) => `media:${messageId}`;

const STATE_KEY = "app_state_v1";

export async function loadAppState<T>(): Promise<T | null> {
  // 优先 IDB，回退 localStorage（迁移旧数据）
  const fromIdb = await idbGet<T>(STATE_KEY, true);
  if (fromIdb) return fromIdb;
  const raw = localStorage.getItem("wap-plus-crm-v1");
  if (!raw) return null;
  const parsed = JSON.parse(raw) as T;
  await idbSet(STATE_KEY, parsed);
  return parsed;
}

/** localStorage 仅保留轻量 settings 备份（不含 API Key），禁止 dump 全量 CRM */
function writeSettingsBackup(data: unknown): void {
  try {
    const settings =
      data && typeof data === "object" && data !== null && "settings" in data
        ? (data as { settings?: unknown }).settings
        : null;
    if (!settings || typeof settings !== "object") return;
    const raw = settings as Record<string, unknown>;
    const {
      openaiKey: _o,
      groqKey: _g,
      geminiKey: _m,
      deepseekKey: _d,
      qwenKey: _q,
      zhipuKey: _z,
      openrouterKey: _r,
      __broadcastCampaigns: _b,
      ...safe
    } = raw;
    localStorage.setItem(
      "wap-plus-crm-settings-v1",
      JSON.stringify(safe)
    );
    // 清理历史全量 key，避免旧巨包继续占额度
    try {
      localStorage.removeItem("wap-plus-crm-v1");
    } catch {
      /* ignore */
    }
  } catch {
    /* quota */
  }
}

export async function saveAppState(data: unknown): Promise<void> {
  await idbSet(STATE_KEY, data);
  writeSettingsBackup(data);
}

export async function clearAppState(): Promise<void> {
  await idbDel(STATE_KEY);
  try {
    localStorage.removeItem("wap-plus-crm-v1");
    localStorage.removeItem("wap-plus-crm-settings-v1");
    localStorage.removeItem("bridgecrm.rateLimit.v1");
  } catch {
    /* ignore */
  }
}
