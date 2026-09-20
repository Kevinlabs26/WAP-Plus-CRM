import assert from "node:assert/strict";
import test from "node:test";

import {
  bridgeMessageMediaCacheId,
  selectMediaCacheEvictions,
} from "../src/lib/mediaCache.ts";

test("media cache evicts the oldest entries until it is under the limit", () => {
  const index = {
    old: { chars: 60, cachedAt: 1 },
    middle: { chars: 50, cachedAt: 2 },
    newest: { chars: 40, cachedAt: 3 },
  };
  assert.deepEqual(selectMediaCacheEvictions(index, 90), ["old"]);
  assert.deepEqual(selectMediaCacheEvictions(index, 50), ["old", "middle"]);
});

test("bridge media uses the same local message id as persisted messages", () => {
  assert.equal(
    bridgeMessageMediaCacheId("ABC/123", "account-1"),
    "bridge-msg-account-1-ABC%2F123"
  );
});
