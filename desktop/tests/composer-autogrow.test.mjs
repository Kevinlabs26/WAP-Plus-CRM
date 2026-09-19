import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../src/components/chat/Composer.tsx", import.meta.url),
  "utf8"
);

test("composer grows with content and caps its height", () => {
  assert.doesNotMatch(source, /\[field-sizing:content\]/);
  assert.match(source, /setTimeout\(\(\) => \{[\s\S]*?scrollHeight[\s\S]*?\}, 160\)/);
  assert.match(source, /max-h-36/);
});
