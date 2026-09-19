import { bridgeInvoke, isTauri } from "@/lib/bridge";

export type AppUpdate = Awaited<ReturnType<typeof checkForAppUpdate>>;

export const PENDING_UPDATE_STORAGE_KEY = "wap-plus.pending-update";

function rememberPendingUpdate(version: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    PENDING_UPDATE_STORAGE_KEY,
    JSON.stringify({ version })
  );
}

export async function checkForAppUpdate() {
  if (!isTauri()) return null;
  const { check } = await import("@tauri-apps/plugin-updater");
  return check({ timeout: 12_000 });
}

export async function installAppUpdate(
  update: NonNullable<AppUpdate>,
  onProgress?: (downloaded: number, total?: number) => void
) {
  let downloaded = 0;
  await update.download((event) => {
    if (event.event === "Started") {
      downloaded = 0;
      onProgress?.(0, event.data.contentLength);
    } else if (event.event === "Progress") {
      downloaded += event.data.chunkLength;
      onProgress?.(downloaded);
    }
  });

  // The updater restarts the app, so the completion dialog is shown by the
  // first launch of the new version rather than by the closing old process.
  rememberPendingUpdate(update.version);

  // Windows starts the installer while the current process is still alive.
  // Stop every sidecar first so the installer can replace wap-plus-baileys.exe.
  await bridgeInvoke("baileys_stop_all");
  await update.install({ restartAfterInstall: true });
}
