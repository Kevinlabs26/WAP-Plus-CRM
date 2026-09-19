import assert from "node:assert/strict";
import { parsePhoneEntries } from "../src/lib/phoneEntries.ts";

assert.deepEqual(
  parsePhoneEntries("1 202 555 0123\n+1-202-555-0124, (1) 2025550125"),
  ["12025550123", "12025550124", "12025550125"]
);
assert.deepEqual(parsePhoneEntries("123; +1 202 555 0123; +1 202 555 0123"), [
  "12025550123",
]);

console.log("phoneEntries ok");
