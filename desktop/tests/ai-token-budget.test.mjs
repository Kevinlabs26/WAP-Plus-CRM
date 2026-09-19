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

assert.match(gemini, /maxOutputTokens/);
assert.match(suggestions, /max_tokens: opts\.auto \? 160 : 300/);
assert.match(suggestions, /num_predict: auto \? 160 : 300/);

console.log("ai-token-budget.test.mjs ok");
