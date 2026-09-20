import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appUpdate = await readFile(
  new URL("../src/lib/appUpdate.ts", import.meta.url),
  "utf8"
);
const baileys = await readFile(
  new URL("../src-tauri/src/baileys.rs", import.meta.url),
  "utf8"
);
const config = JSON.parse(
  await readFile(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8")
);
const hooks = await readFile(
  new URL("../src-tauri/windows/installer-hooks.nsh", import.meta.url),
  "utf8"
);
const releaseWorkflow = await readFile(
  new URL("../../.github/workflows/release.yml", import.meta.url),
  "utf8"
);
const installerSmokeTest = await readFile(
  new URL("../../.github/scripts/smoke-windows-installer.ps1", import.meta.url),
  "utf8"
);

assert.match(appUpdate, /onProgress\?\.\(downloaded, total\)/);
assert.match(baileys, /guard\.update_started = true/);
assert.match(baileys, /if guard\.update_started/);
assert.match(baileys, /pub fn cancel_update/);
assert.match(appUpdate, /bridgeInvoke\("baileys_cancel_update"\)/);
assert.equal(
  config.bundle.windows.nsis.installerHooks,
  "windows/installer-hooks.nsh"
);
assert.match(hooks, /taskkill\.exe.*wap-plus-baileys\.exe/i);
assert.match(releaseWorkflow, /releaseDraft:\s*true/);
assert.match(releaseWorkflow, /smoke-windows-installer\.ps1/);
assert.match(releaseWorkflow, /gh release edit.*--draft=false/);
assert.match(installerSmokeTest, /Start-Process[^\n]+\/S/);
assert.match(installerSmokeTest, /wap-plus-crm\.exe/);
assert.match(installerSmokeTest, /wap-plus-baileys\.exe/);

console.log("updater safety: ok");
