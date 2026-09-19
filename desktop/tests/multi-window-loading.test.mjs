import test from "node:test";
import assert from "node:assert/strict";
import { selectVisibleLoadIds } from "../src/features/multiWindow/lib/loading.ts";

test("collapsed multi-window cards are skipped during history loading", () => {
  assert.deepEqual(
    selectVisibleLoadIds(["a", "b"], { a: "a2", b: "b2" }, new Set(["b"])),
    ["a", "a2"]
  );
});

test("visible loading keeps each active account conversation once", () => {
  assert.deepEqual(
    selectVisibleLoadIds(["a", "b"], { a: "a", b: "b2" }, new Set()),
    ["a", "b", "b2"]
  );
});
