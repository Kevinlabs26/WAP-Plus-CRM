import { bridgeInvoke, isTauri } from "@/lib/bridge";

type UpdateDownloadEvent =
  | { event: "Started"; data?: { contentLength?: number } }
  | { event: "Progress"; data?: { chunkLength?: number } }
  | { event: "Finished"; data?: Record<string, never> };

export type AppUpdate = {
  version: string;
  download: (
    onEvent?: (event: UpdateDownloadEvent) => void
  ) => Promise<void>;
  install: (options: { restartAfterInstall: boolean }) => Promise<void>;
} | null;

export const PENDING_UPDATE_STORAGE_KEY = "wap-plus.pending-update";
let updateCheckInFlight: Promise<AppUpdate> | null = null;

function rememberPendingUpdate(version: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    PENDING_UPDATE_STORAGE_KEY,
    JSON.stringify({ version })
  );
}

export async function checkForAppUpdate(): Promise<AppUpdate> {
  if (!isTauri()) return null;
  if (updateCheckInFlight) return updateCheckInFlight;
  updateCheckInFlight = (async () => {
    const { check } = await import("@tauri-apps/plugin-updater");
    return check({ timeout: 12_000 });
  })();
  try {
    return await updateCheckInFlight;
  } finally {
    updateCheckInFlight = null;
  }
}

export async function installAppUpdate(
  update: NonNullable<AppUpdate>,
  onProgress?: (downloaded: number, total?: number) => void
) {
  let downloaded = 0;
  let total: number | undefined;
  await update.download((event) => {
    if (event.event === "Started") {
      downloaded = 0;
      total = event.data?.contentLength;
      onProgress?.(0, total);
    } else if (event.event === "Progress") {
      downloaded += event.data?.chunkLength || 0;
      onProgress?.(downloaded, total);
    } else if (event.event === "Finished") {
      onProgress?.(total ?? downloaded, total);
    }
  });

  // The updater restarts the app, so the completion dialog is shown by the
  // first launch of the new version rather than by the closing old process.
  rememberPendingUpdate(update.version);

  // Windows starts the installer while the current process is still alive.
  // Stop every sidecar first so the installer can replace wap-plus-baileys.exe.
  await bridgeInvoke("baileys_stop_all");
  try {
    await update.install({ restartAfterInstall: true });
  } catch (error) {
    window.localStorage.removeItem(PENDING_UPDATE_STORAGE_KEY);
    await bridgeInvoke("baileys_cancel_update").catch(() => undefined);
    throw error;
  }
}
