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
assert.match(suggestions, /const SINGLE_REPLY_TOKENS = 512/);
assert.match(suggestions, /const MULTI_REPLY_TOKENS = 1536/);
assert.match(suggestions, /chatCompletionOptions\([^\n]+opts\.auto \|\| opts\.replyTo \|\| opts\.count === 1 \? SINGLE_REPLY_TOKENS : MULTI_REPLY_TOKENS\)/);
assert.match(suggestions, /num_predict: auto \|\| replyTo \|\| count === 1 \? SINGLE_REPLY_TOKENS : MULTI_REPLY_TOKENS/);
assert.equal(
  [...suggestions.matchAll(/signal: .*AbortSignal\.timeout\(60_000\)/g)].length,
  2
);
assert.equal(
  [...customerCard.matchAll(/signal: AbortSignal\.timeout\(60_000\)/g)].length,
  4
);

console.log("ai-token-budget.test.mjs ok");
