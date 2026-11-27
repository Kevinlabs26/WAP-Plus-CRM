import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const target = { arm64: "aarch64-apple-darwin", x64: "x86_64-apple-darwin" }[process.arch];
if (process.platform !== "darwin" || !target) {
  throw new Error("Run the macOS sidecar build on a Mac with native arm64 or x64 Node.js.");
}

const directory = fileURLToPath(new URL("../src-tauri/binaries/", import.meta.url));
mkdirSync(directory, { recursive: true });
const output = fileURLToPath(new URL(`../src-tauri/binaries/wap-plus-baileys-${target}`, import.meta.url));
const result = spawnSync("bun", ["build", "--compile", "--outfile", output, "index.mjs"], {
  cwd: fileURLToPath(new URL("./", import.meta.url)),
  stdio: "inherit",
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
