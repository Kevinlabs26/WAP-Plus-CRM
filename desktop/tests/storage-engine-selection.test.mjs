import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../src/lib/storage.ts", import.meta.url),
  "utf8"
);

assert.match(source, /import \{ isTauri \} from "@\/lib\/bridge"/);
assert.match(
  source,
  /info\?\.engine === "sqlite" \|\| isTauri\(\) \? "sqlite" : "idb"/
);

console.log("storage-engine-selection.test.mjs ok");
