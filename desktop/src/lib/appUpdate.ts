import { bridgeInvoke, isTauri } from "@/lib/bridge";

export type AppUpdate = Awaited<ReturnType<typeof checkForAppUpdate>>;

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

  // Windows starts the installer while the current process is still alive.
  // Stop every sidecar first so the installer can replace wap-plus-baileys.exe.
  await bridgeInvoke("baileys_stop_all");
  await update.install({ restartAfterInstall: true });
}
