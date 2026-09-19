import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const cargo = await readFile(
  new URL("../src-tauri/Cargo.toml", import.meta.url),
  "utf8"
);

assert.match(
  cargo,
  /sherpa-rs\s*=\s*\{[^}]*default-features\s*=\s*false[^}]*"static"[^}]*\}/
);

console.log("speech runtime is statically linked");
