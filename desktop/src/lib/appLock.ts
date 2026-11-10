import { invoke } from "@tauri-apps/api/core";

export type AppLockStatus = { supported: boolean; configured: boolean };

export const getAppLockStatus = async (): Promise<AppLockStatus> => {
  try {
    return await invoke<AppLockStatus>("app_lock_status");
  } catch (error) {
    const message = String(error);
    // shortcut: old dev binaries lack the lock command; enable it after relaunch, while real storage errors stay fail-closed.
    if (/app_lock_status/i.test(message) && /not found|unknown command/i.test(message)) {
      return { supported: false, configured: false };
    }
    throw error;
  }
};

export const createAppLockPassword = (password: string) =>
  invoke<void>("app_lock_create", { password });

export const verifyAppLockPassword = (password: string) =>
  invoke<boolean>("app_lock_verify", { password });

export const changeAppLockPassword = (currentPassword: string, newPassword: string) =>
  invoke<boolean>("app_lock_change", {
    currentPassword,
    newPassword,
  });
