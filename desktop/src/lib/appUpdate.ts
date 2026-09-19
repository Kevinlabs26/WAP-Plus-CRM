import { isTauri } from "@/lib/bridge";

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
  await update.downloadAndInstall((event) => {
    if (event.event === "Started") {
      downloaded = 0;
      onProgress?.(0, event.data.contentLength);
    } else if (event.event === "Progress") {
      downloaded += event.data.chunkLength;
      onProgress?.(downloaded);
    }
  }, { restartAfterInstall: true });
}
