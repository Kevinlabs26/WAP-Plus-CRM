import test from "node:test";
import assert from "node:assert/strict";
import { prioritizePinned } from "../src/features/multiWindow/lib/pinned.ts";

test("pinned multi-window cards stay before unpinned cards", () => {
  assert.deepEqual(
    prioritizePinned(["a", "b", "c"], new Set(["c", "a"])),
    ["a", "c", "b"]
  );
});

test("pinned ordering keeps the existing order within each group", () => {
  assert.deepEqual(
    prioritizePinned(["a", "b", "c", "d"], new Set(["b", "d"])),
    ["b", "d", "a", "c"]
  );
});
