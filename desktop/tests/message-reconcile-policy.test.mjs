import test from "node:test";
import assert from "node:assert/strict";
import {
  isLiveMessagesSyncPayload,
  needsFullMessageReconcile,
} from "../src/store/messageReconcilePolicy.ts";

test("live message upserts stay incremental", () => {
  assert.equal(isLiveMessagesSyncPayload({ live: true }), true);
  assert.equal(isLiveMessagesSyncPayload({ source: "enrich" }), true);
  assert.equal(
    needsFullMessageReconcile([
      { type: "messages.sync", payload: { live: true, items: [{}] } },
    ]),
    false
  );
});

test("completed history work and deletes still run full repair", () => {
  assert.equal(
    needsFullMessageReconcile([
      {
        type: "messages.sync",
        payload: { live: false, source: "history", syncBatchFinal: true },
      },
    ]),
    true
  );
  assert.equal(
    needsFullMessageReconcile([
      {
        type: "messages.sync",
        payload: { source: "snapshot", syncBatchFinal: false },
      },
    ]),
    false
  );
  assert.equal(
    needsFullMessageReconcile([{ type: "messages.delete", payload: {} }]),
    true
  );
});

test('protocol history chunks only run full repair after the final chunk', () => {
  for (let index = 0; index < 100; index++) {
    assert.equal(needsFullMessageReconcile([{ type: 'messages.sync', payload: {
      source: 'history', live: false, syncBatchFinal: true, historyChunk: { index, total: 100 },
    } }]), index === 99);
  }
  assert.equal(needsFullMessageReconcile([{ type: 'messages.sync', payload: {
    source: 'history', syncBatchFinal: false, historyChunk: { index: 99, total: 100 },
  } }]), false, 'last protocol chunk can still have unfinished frontend slices');
});
