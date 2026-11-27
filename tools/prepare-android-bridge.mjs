import { execFileSync } from "node:child_process";
import { copyFileSync } from "node:fs";

const android = new URL("../android/", import.meta.url);
// shortcut: bundle the existing debug APK for fresh installs; use a stable signing key before supporting updates.
const [runner, ...args] = process.platform === "win32"
  ? ["cmd.exe", "/d", "/c", "gradlew.bat"]
  : ["bash", "./gradlew"];
execFileSync(runner, [...args, "--dependency-verification", "strict", ":app:assembleDebug"], {
  cwd: android,
  stdio: "inherit",
  windowsHide: true,
});
copyFileSync(
  new URL("app/build/outputs/apk/debug/app-debug.apk", android),
  new URL("../desktop/src-tauri/resources/android-bridge/bridge.apk", import.meta.url),
);
