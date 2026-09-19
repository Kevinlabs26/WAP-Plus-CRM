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
