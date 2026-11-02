import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./bridge";
import { createBackupBundle } from "../store/exportDataActions";
import { getDataRestoreGeneration, isDataRestoreActive } from "../store/restoreGuard";
import type { AppState } from "../store/types";
import { flushPersist } from "../store/persist";
import { getStorageEngine } from "@/lib/storage";
import { buildExportBundle } from "./exportData";

export interface AutomaticBackupStatus { folder: string; latestDay: string | null }
let running = false;

export async function runAutomaticBackup(get: () => AppState, force = false): Promise<AutomaticBackupStatus | null> {
  if (!isTauri() || !get().hydrated || isDataRestoreActive() || (!force && get().settings.automaticBackupEnabled === false)) return null;
  if (running) {
    if (force) throw new Error("正在备份，请稍后重试");
    return null;
  }
  running = true;
  const restoreGeneration = getDataRestoreGeneration();
  try {
    const status = await invoke<AutomaticBackupStatus>("crm_backup_status");
    const now = new Date();
    const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    if (!force && status.latestDay === day) return status;
    if (isDataRestoreActive() || getDataRestoreGeneration() !== restoreGeneration) return null;
    const state = get();
    await flushPersist(() => state);
    if (isDataRestoreActive() || getDataRestoreGeneration() !== restoreGeneration) return null;
    const fromDatabase = getStorageEngine() === "sqlite";
    const { bundle } = fromDatabase
      ? { bundle: buildExportBundle({ ...state, phones: [], contacts: [], chats: [], followUps: [], messages: [], activities: [] }) }
      : await createBackupBundle(state);
    if (isDataRestoreActive() || getDataRestoreGeneration() !== restoreGeneration) return null;
    const content = JSON.stringify(bundle);
    if (new Blob([content]).size > 256 * 1024 * 1024) throw new Error("备份元数据超过 256 MiB，已停止保存；原数据与已有备份保留");
    const saved = await invoke<AutomaticBackupStatus>("crm_backup_save", { content, fromDatabase });
    if (typeof window !== "undefined") window.dispatchEvent(new Event("wap:automatic-backup"));
    return saved;
  } finally { running = false; }
}

export async function readLatestAutomaticBackup(): Promise<unknown> {
  const fields = ["phones", "contacts", "chats", "followUps", "messages", "activities"];
  const info = await invoke<{ id: string; parts: number }>("crm_backup_latest_info");
  if (!info || typeof info.id !== "string" || !Number.isInteger(info.parts) || info.parts < 1 || info.parts > 4096) {
    throw new Error("自动备份清单无效");
  }
  const bundle = JSON.parse(await invoke<string>("crm_backup_read_part", { id: info.id, index: 0 }));
  if (!bundle || bundle.version !== 2 || bundle.app !== "WAP Plus CRM" || fields.some(key => !Array.isArray(bundle[key]))) {
    throw new Error("自动备份格式无效");
  }
  for (let index = 1; index < info.parts; index++) {
    const part = JSON.parse(await invoke<string>("crm_backup_read_part", { id: info.id, index }));
    if (!part || typeof part !== "object" || Array.isArray(part) || !Object.keys(part).length ||
        Object.keys(part).some(key => !fields.includes(key) || !Array.isArray(part[key]))) {
      throw new Error("自动备份分段格式无效");
    }
    for (const key of Object.keys(part)) for (const row of part[key]) bundle[key].push(row);
  }
  return bundle;
}
