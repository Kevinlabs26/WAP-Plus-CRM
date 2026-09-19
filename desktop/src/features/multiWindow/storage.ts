import type { LayoutMode, SortMode } from "./types";

export const MULTI_WINDOW_STORAGE_VERSION = 1;
export const STORAGE_KEY = "wap.multiWindowChatIds";
export const FOLDER_STORAGE_KEY = "wap.multiWindowFolderChatIds";
export const MANUAL_MEMBERS_KEY = "wap.multiWindowManualMembers";
export const ACTIVE_MEMBER_KEY = "wap.multiWindowActiveMembers";
export const RECENT_QUEUE_KEY = "wap.multiWindowRecentQueue";
export const SORT_MODE_KEY = "wap.multiWindowSortMode";
export const IGNORE_GROUPS_KEY = "wap.multiWindowIgnoreGroups";
export const FOLDER_IDS_KEY = "wap.multiWindowFolderIds";
export const LAYOUT_MODE_KEY = "wap.multiWindowLayoutMode";
export const COMPACT_MODE_KEY = "wap.multiWindowCompactMode";
export const COLLAPSED_WINDOWS_KEY = "wap.multiWindowCollapsedWindows";
export const PINNED_WINDOWS_KEY = "wap.multiWindowPinnedWindows";

export function scopedStorageKey(key: string, accountScopeId?: string) {
  return accountScopeId ? `${key}.${encodeURIComponent(accountScopeId)}` : key;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "null");
    return parsed === null ? fallback : parsed as T;
  } catch {
    return fallback;
  }
}

function readStringArray(key: string) {
  const parsed = readJson<unknown>(key, []);
  return Array.isArray(parsed)
    ? parsed.filter((id): id is string => typeof id === "string")
    : [];
}

export function readStoredChatIds(key = STORAGE_KEY) {
  return readStringArray(key);
}

export function readStoredCollapsedWindowIds(accountScopeId?: string) {
  return readStringArray(scopedStorageKey(COLLAPSED_WINDOWS_KEY, accountScopeId));
}

export function readStoredPinnedWindowIds(accountScopeId?: string) {
  return readStringArray(scopedStorageKey(PINNED_WINDOWS_KEY, accountScopeId));
}

export function readStoredFolderIds(accountScopeId?: string) {
  return readStringArray(scopedStorageKey(FOLDER_IDS_KEY, accountScopeId));
}

export function readStoredManualMembers(accountScopeId?: string) {
  const parsed = readJson<unknown>(scopedStorageKey(MANUAL_MEMBERS_KEY, accountScopeId), {});
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return Object.fromEntries(
    Object.entries(parsed).filter(([, ids]) =>
      Array.isArray(ids) && ids.every((id) => typeof id === "string")
    )
  ) as Record<string, string[]>;
}

export function readStoredActiveMembers(accountScopeId?: string) {
  const parsed = readJson<unknown>(scopedStorageKey(ACTIVE_MEMBER_KEY, accountScopeId), {});
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return Object.fromEntries(
    Object.entries(parsed).filter(
      ([windowId, chatId]) => typeof windowId === "string" && typeof chatId === "string"
    )
  ) as Record<string, string>;
}

export function readRecentQueueIds(accountScopeId?: string) {
  return readStringArray(scopedStorageKey(RECENT_QUEUE_KEY, accountScopeId));
}

export function readSortMode(accountScopeId?: string): SortMode {
  try {
    const value = localStorage.getItem(scopedStorageKey(SORT_MODE_KEY, accountScopeId));
    return value === "recent" || value === "opened" ? value : "priority";
  } catch {
    return "priority";
  }
}

export function readIgnoreGroups(accountScopeId?: string) {
  try {
    return localStorage.getItem(scopedStorageKey(IGNORE_GROUPS_KEY, accountScopeId)) !== "false";
  } catch {
    return true;
  }
}

export function readLayoutMode(accountScopeId?: string): LayoutMode {
  try {
    const value = localStorage.getItem(scopedStorageKey(LAYOUT_MODE_KEY, accountScopeId));
    return value === "one" || value === "two" || value === "three" ? value : "auto";
  } catch {
    return "auto";
  }
}

export function readCompactMode(accountScopeId?: string) {
  try {
    return localStorage.getItem(scopedStorageKey(COMPACT_MODE_KEY, accountScopeId)) === "true";
  } catch {
    return false;
  }
}

export function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* localStorage is optional */
  }
}

export function writeString(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* localStorage is optional */
  }
}
