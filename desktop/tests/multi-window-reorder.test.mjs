import test from "node:test";
import assert from "node:assert/strict";
import { moveByOffset, moveId } from "../src/features/multiWindow/lib/reorder.ts";

test("multi-window reorder moves a card before the target", () => {
  assert.deepEqual(moveId(["a", "b", "c"], "c", "a"), ["c", "a", "b"]);
  assert.deepEqual(moveId(["a", "b", "c"], "a", "c"), ["b", "a", "c"]);
});

test("multi-window reorder keeps invalid or identical moves unchanged", () => {
  const ids = ["a", "b", "c"];
  assert.deepEqual(moveId(ids, "b", "b"), ids);
  assert.deepEqual(moveId(ids, "x", "b"), ids);
  assert.deepEqual(moveId(ids, "b", "x"), ids);
});

test("multi-window reorder moves cards with keyboard offsets", () => {
  assert.deepEqual(moveByOffset(["a", "b", "c"], "b", -1), ["b", "a", "c"]);
  assert.deepEqual(moveByOffset(["a", "b", "c"], "b", 1), ["a", "c", "b"]);
  assert.deepEqual(moveByOffset(["a", "b", "c"], "a", -1), ["a", "b", "c"]);
});
