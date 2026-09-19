import { test, after } from "node:test";
import assert from "node:assert/strict";
import { enqueueGatedIngest } from "../src/lib/ingestGate.ts";
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

after(() => {
  globalThis.window = originalWindow;
  globalThis.document = originalDocument;
});
