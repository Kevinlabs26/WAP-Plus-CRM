import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../src/channels/mediaGate.ts", import.meta.url),
  "utf8"
);

assert.match(source, /MAX_AUTO_RETRY_WAIT_MS\s*=\s*15_000/);
assert.match(source, /MAX_AUTO_RETRIES\s*=\s*3/);
assert.match(source, /setTimeout\(resolve, waitMs \+ 100\)/);
assert.match(source, /out\.gate\.error !== "rate_limited"/);

console.log("media-gate-retry.test.mjs ok");
