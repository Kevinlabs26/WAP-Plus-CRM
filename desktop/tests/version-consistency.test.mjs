import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const rootPackage = JSON.parse(
  await readFile(new URL("../../package.json", import.meta.url), "utf8")
);
const desktopPackage = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8")
);
const tauriConfig = JSON.parse(
  await readFile(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8")
);
const cargoToml = await readFile(
  new URL("../src-tauri/Cargo.toml", import.meta.url),
  "utf8"
);
const cargoVersion = cargoToml.match(/^version\s*=\s*"([^"]+)"/m)?.[1];

assert.ok(cargoVersion, "Cargo package version is missing");
assert.equal(desktopPackage.version, rootPackage.version);
assert.equal(tauriConfig.version, rootPackage.version);
assert.equal(cargoVersion, rootPackage.version);

console.log(`version consistency: ${rootPackage.version}`);
