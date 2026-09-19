import assert from "node:assert/strict";
import { isRetryableOutgoing } from "../src/store/outgoingRetry.ts";

const base = {
  id: "m1",
  chatId: "c1",
  direction: "out",
  body: "hello",
  phoneE164: "+12025550100",
  sentAt: "2026-08-12T10:00:00.000Z",
  deliveryStatus: "failed",
};

// 硬失败（无计划时间）只允许手动重试，不能被队列自动捞起重复发送
assert.equal(isRetryableOutgoing(base), false);
// queued 无计划时间 = 立即到期
assert.equal(isRetryableOutgoing({ ...base, deliveryStatus: "queued" }), true);
// failed 但带未来计划时间：到期前不可重试
assert.equal(
  isRetryableOutgoing(
    { ...base, nextAttemptAt: "2026-08-12T12:00:01.000Z" },
    Date.parse("2026-08-12T12:00:00.000Z")
  ),
  false
);
// failed 且计划时间已到：可自动重试
assert.equal(
  isRetryableOutgoing(
    { ...base, nextAttemptAt: "2026-08-12T11:59:59.000Z" },
    Date.parse("2026-08-12T12:00:00.000Z")
  ),
  true
);
assert.equal(
  isRetryableOutgoing({ ...base, systemKind: "broadcast_campaign", deliveryStatus: "queued" }),
  false
);
assert.equal(isRetryableOutgoing({ ...base, deliveryStatus: "queued", retryCount: 5 }), false);

console.log("outgoing-retry.test.mjs ok");
