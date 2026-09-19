import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const roots = [
  fileURLToPath(new URL("../src", import.meta.url)),
  fileURLToPath(new URL("../../../Websit/js", import.meta.url)),
];
const nativeDialog = /\b(?:window\.)?(?:alert|confirm|prompt)\s*\(/u;

async function sourceFiles(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)));
    else if ([".js", ".ts", ".tsx"].includes(extname(entry.name))) files.push(path);
  }
  return files;
}

for (const root of roots) {
  for (const file of await sourceFiles(root)) {
    assert.doesNotMatch(await readFile(file, "utf8"), nativeDialog, file);
  }
}
