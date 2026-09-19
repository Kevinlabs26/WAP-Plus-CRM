import test from "node:test";
import assert from "node:assert/strict";
import { updateCollapsedWindowIds } from "../src/features/multiWindow/lib/collapse.ts";

test("collapse action adds only the current page windows", () => {
  assert.deepEqual(
    updateCollapsedWindowIds(["old"], ["a", "b"], true),
    ["old", "a", "b"]
  );
});

test("expand action removes only the current page windows", () => {
  assert.deepEqual(
    updateCollapsedWindowIds(["old", "a", "b"], ["a", "b"], false),
    ["old"]
  );
});
