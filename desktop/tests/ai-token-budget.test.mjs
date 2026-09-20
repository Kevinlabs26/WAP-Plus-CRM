import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const gemini = await readFile(
  new URL("../src/lib/gemini.ts", import.meta.url),
  "utf8"
);
const suggestions = await readFile(
  new URL("../src/lib/aiSuggest.ts", import.meta.url),
  "utf8"
);
const customerCard = await readFile(
  new URL("../src/lib/aiCustomerCard.ts", import.meta.url),
  "utf8"
);

assert.match(gemini, /maxOutputTokens/);
assert.match(suggestions, /max_tokens: opts\.auto \? 160 : 300/);
assert.match(suggestions, /num_predict: auto \? 160 : 300/);
assert.equal(
  [...suggestions.matchAll(/signal: AbortSignal\.timeout\(60_000\)/g)].length,
  2
);
assert.equal(
  [...customerCard.matchAll(/signal: AbortSignal\.timeout\(60_000\)/g)].length,
  2
);

console.log("ai-token-budget.test.mjs ok");
