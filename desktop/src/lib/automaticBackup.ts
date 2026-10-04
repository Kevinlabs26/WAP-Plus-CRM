import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./bridge";
import { createBackupBundle } from "../store/exportDataActions";
import { getDataRestoreGeneration, isDataRestoreActive } from "../store/restoreGuard";
import type { AppState } from "../store/types";

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
    const { bundle } = await createBackupBundle(get());
    if (isDataRestoreActive() || getDataRestoreGeneration() !== restoreGeneration) return null;
    const content = JSON.stringify(bundle);
    if (new Blob([content]).size > 256 * 1024 * 1024) throw new Error("备份超过 256 MiB，请使用手动导出");
    const saved = await invoke<AutomaticBackupStatus>("crm_backup_save", { content });
    if (typeof window !== "undefined") window.dispatchEvent(new Event("wap:automatic-backup"));
    return saved;
  } finally { running = false; }
}
