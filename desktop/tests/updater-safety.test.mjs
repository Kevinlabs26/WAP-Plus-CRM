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

assert.match(appUpdate, /onProgress\?\.\(downloaded, total\)/);
assert.match(baileys, /guard\.update_started = true/);
assert.match(baileys, /if guard\.update_started/);
assert.equal(
  config.bundle.windows.nsis.installerHooks,
  "windows/installer-hooks.nsh"
);
assert.match(hooks, /taskkill\.exe.*wap-plus-baileys\.exe/i);

console.log("updater safety: ok");
