import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
assert.match(releaseWorkflow, /needs: \[build-windows, build-macos\]/);
const publishScript = await readFile(
  new URL("../../.github/scripts/publish-desktop-release.sh", import.meta.url),
  "utf8"
);
assert.match(publishScript, /gh release edit.*--draft=false/);
assert.match(installerSmokeTest, /Start-Process[^\n]+\/S/);
assert.match(installerSmokeTest, /wap-plus-crm\.exe/);
assert.match(installerSmokeTest, /wap-plus-baileys\.exe/);

const macConfig = JSON.parse(await readFile(new URL("../src-tauri/tauri.macos.conf.json", import.meta.url), "utf8"));
assert.deepEqual(macConfig.plugins.updater.endpoints, ["https://raw.githubusercontent.com/Kevinlabs26/WAP-Plus-CRM/macos-updates/latest-unsigned.json"]);
assert.match(config.plugins.updater.endpoints[0], /releases\/latest\/download\/latest\.json$/);
assert.match(appUpdate, /await update\.install[\s\S]*?await bridgeInvoke\("restart_after_macos_update"\)/);

const assets = await mkdtemp(join(tmpdir(), "wap-macos-update-"));
try {
  const script = fileURLToPath(new URL("../../.github/scripts/macos-update-manifest.mjs", import.meta.url));
  const tag = "v0.1.81";
  const args = [script, "0.1.81", tag, assets];
  for (const arch of ["arm64", "x86_64"]) {
    await writeFile(join(assets, `WAP-Plus-CRM-0.1.81-macOS-${arch}.app.tar.gz`), arch);
  }
  await writeFile(join(assets, "WAP-Plus-CRM-0.1.81-macOS-arm64.app.tar.gz.sig"), "YXJt\n");
  assert.throws(() => execFileSync(process.execPath, args, { stdio: "pipe" }), /x86_64\.app\.tar\.gz\.sig/);
  await writeFile(join(assets, "WAP-Plus-CRM-0.1.81-macOS-x86_64.app.tar.gz.sig"), "aW50ZWw=\n");
  const manifest = JSON.parse(execFileSync(process.execPath, args, { encoding: "utf8" }));
  assert.equal(manifest.version, "0.1.81");
  assert.deepEqual(Object.keys(manifest.platforms), ["darwin-aarch64", "darwin-x86_64"]);
  assert.equal(manifest.platforms["darwin-aarch64"].signature, "YXJt");
  assert.equal(manifest.platforms["darwin-x86_64"].signature, "aW50ZWw=");
  assert.match(manifest.platforms["darwin-aarch64"].url, /\/releases\/download\/v0\.1\.81\/.*-arm64\.app\.tar\.gz$/);
  assert.match(manifest.platforms["darwin-x86_64"].url, /\/releases\/download\/v0\.1\.81\/.*-x86_64\.app\.tar\.gz$/);
} finally {
  await rm(assets, { recursive: true, force: true });
}

console.log("updater safety: ok");
