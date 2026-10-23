import { test, after } from "node:test";
import assert from "node:assert/strict";
import { enqueueGatedIngest, hasRealtimeIngestEvents } from "../src/lib/ingestGate.ts";
import {
  isComposerInputFocused,
  markComposerInput,
} from "../src/lib/composerActivity.ts";

const originalWindow = globalThis.window;
const originalDocument = globalThis.document;

function makeWindow() {
  const timers = [];
  return {
    timers,
    window: {
      setTimeout: (fn, ms) => {
        timers.push(fn);
        return timers.length;
      },
      requestIdleCallback: (fn) => fn({}),
    },
  };
}

function focusComposer(now) {
  globalThis.document = {
    hidden: false,
    activeElement: { getAttribute: () => "true" },
  };
  markComposerInput(now);
}

function blurComposer() {
  globalThis.document = originalDocument;
}

test("gated ingest: not busy flushes immediately via idle callback", () => {
  const { timers, window } = makeWindow();
  globalThis.window = window;
  blurComposer();

  const ingested = [];
  enqueueGatedIngest([{ type: "a" }], (events) => ingested.push(...events));
  assert.equal(ingested.length, 1);
  assert.equal(timers.length, 0);
});

test("gated ingest: defers while typing, flushes after input stops", () => {
  const { timers, window } = makeWindow();
  globalThis.window = window;
  const now = Date.now();
  focusComposer(now);

  const ingested = [];
  enqueueGatedIngest([{ type: "b" }], (events) => ingested.push(...events));
  // 输入框聚焦且近期有输入 → 只入队，不立刻入库
  assert.equal(ingested.length, 0);
  assert.equal(isComposerInputFocused(), true);
  assert.ok(timers.length > 0, "expected a deferral retry timer");

  // 用户停下输入/离开输入框 → 放行，先前排队的批次入库
  blurComposer();
  for (const fn of timers) fn();
  assert.equal(ingested.length, 1);
});

test("gated ingest: caps batch size and drains the rest", () => {
  const { window } = makeWindow();
  globalThis.window = window;
  blurComposer();

  const ingested = [];
  const batchSizes = [];
  const events = Array.from({ length: 1200 }, (_, i) => ({ type: `e${i}` }));
  enqueueGatedIngest(events, (batch) => {
    batchSizes.push(batch.length);
    ingested.push(...batch);
  });
  assert.deepEqual(batchSizes, [500, 500, 200]);
  assert.equal(ingested.length, 1200);
});

test("gated ingest waits for an async batch before starting the next", async () => {
  const { window } = makeWindow(); globalThis.window = window; blurComposer();
  const batches=[]; let release;
  const ingest = events => { batches.push(events); return new Promise(resolve => { release = resolve; }); };
  enqueueGatedIngest([{type:"first"}], ingest);
  enqueueGatedIngest([{type:"second"}], ingest);
  assert.equal(batches.length,1);
  release(); await Promise.resolve();
  assert.equal(batches.length,2);
  release(); await Promise.resolve();
});

test("live messages bypass typing deferral while history ahead of them keeps its order", () => {
  const { timers, window } = makeWindow(); globalThis.window = window; focusComposer(Date.now());
  const received = [], ingest = events => received.push(...events);
  const history = { type: "messages.sync", payload: { live: false, source: "history", items: [{ id: "old" }] } };
  const live = { type: "messages.sync", payload: { live: true, items: [{ id: "new" }] } };
  enqueueGatedIngest([history], ingest);
  assert.equal(received.length, 0);
  enqueueGatedIngest([live], ingest);
  timers.shift()();
  assert.deepEqual(received, [history, live]);
  assert.equal(isComposerInputFocused(), true);
  blurComposer();
});

test("continuous typing cannot postpone queued history forever", () => {
  const { timers, window } = makeWindow(); globalThis.window = window;
  const originalNow = Date.now; let now = originalNow(); Date.now = () => now;
  try {
    focusComposer(now); const received = [];
    enqueueGatedIngest([{ type: "contacts.sync", payload: { source: "history" } }], events => received.push(...events));
    assert.equal(received.length, 0);
    now += 1001; markComposerInput(now); timers.shift()();
    assert.equal(received.length, 1);
  } finally { Date.now = originalNow; blurComposer(); }
});

test("realtime classification retains the message store's live and history semantics", () => {
  for (const source of ["history", "snapshot", "sync"]) {
    assert.equal(hasRealtimeIngestEvents([{ type: "messages.sync", payload: { source } }]), false);
    assert.equal(hasRealtimeIngestEvents([{ type: "messages.sync", payload: { source, live: true } }]), true);
  }
  assert.equal(hasRealtimeIngestEvents([{ type: "messages.sync", payload: { live: false } }]), false);
  assert.equal(hasRealtimeIngestEvents([{ type: "messages.sync", payload: {} }]), true);
  assert.equal(hasRealtimeIngestEvents([{ type: "contacts.sync", payload: { source: "message" } }]), true);
  for (const type of ["messages.ack", "messages.delete", "chats.delete"]) assert.equal(hasRealtimeIngestEvents([{ type }]), true);
});

after(() => {
  globalThis.window = originalWindow;
  globalThis.document = originalDocument;
});
