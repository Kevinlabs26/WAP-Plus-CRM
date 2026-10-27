import assert from "node:assert/strict";
import test from "node:test";
import { mergeMessagesByTime } from "../src/store/messageOrdering.ts";

const message = (id, sentAt) => ({ id, sentAt });

test("mergeMessagesByTime inserts history in order and skips duplicates", () => {
  const existing = [message("b", "2026-01-02"), message("d", "2026-01-04")];
  const merged = mergeMessagesByTime(existing, [
    message("a", "2026-01-01"),
    message("d", "2026-01-04"),
    message("c", "2026-01-03"),
  ]);

  assert.deepEqual(merged.map((item) => item.id), ["a", "b", "c", "d"]);
  assert.equal(mergeMessagesByTime(existing, [existing[0]]), existing);
});

test("mergeMessagesByTime skips protocol aliases for the same message", () => {
  const existing = [{
    id: "msg-local-1",
    accountId: "account-1",
    deviceId: "account-1",
    body: "hello",
    sentAt: "2026-09-22T10:00:00.000Z",
    waMessageId: "wa-1",
  }];
  const merged = mergeMessagesByTime(existing, [{
    id: "bridge-msg-1",
    accountId: "account-1",
    deviceId: "account-1",
    body: "hello",
    sentAt: "2026-09-22T10:00:00.000Z",
    waKey: { id: "wa-1" },
  }]);
  assert.equal(merged.length, 1);
});

test("mergeMessagesByTime drops secret protocol placeholders", () => {
  const hidden = { ...message("hidden", "2026-01-03"), body: "[secretEncrypted]" };
  assert.deepEqual(mergeMessagesByTime([hidden], []), []);
  assert.deepEqual(mergeMessagesByTime([], [hidden]), []);
});

test("mergeMessagesByTime drops WhatsApp pin protocol bodies", () => {
  const pin = { ...message("pin", "2026-01-03"), body: "[pinInChat]" };
  assert.deepEqual(mergeMessagesByTime([pin], []), []);
  assert.deepEqual(mergeMessagesByTime([], [pin]), []);
});

test("mergeMessagesByTime repairs live arrival order even when a disk page is empty or contains only duplicates", () => {
  const outgoing = message("outgoing", "2026-10-27T11:27:09.181Z");
  const incoming = message("incoming", "2026-10-27T11:27:25.000Z");
  const existing = [incoming, outgoing];
  for (const page of [[], [outgoing, incoming]]) {
    const merged = mergeMessagesByTime(existing, page);
    assert.deepEqual(merged, [outgoing, incoming]);
    assert.equal(merged[0], outgoing);
    assert.equal(merged[1], incoming);
    assert.deepEqual(existing, [incoming, outgoing], "do not mutate the live input array");
  }
});

test("new history merges correctly into an unsorted multi-account live buffer without changing timestamps", () => {
  const before = { ...message("before", "2026-10-27T11:26:00.000Z"), accountId: "a" };
  const out = { ...message("out", "2026-10-27T11:27:09.181Z"), accountId: "a" };
  const reply = { ...message("reply", "2026-10-27T11:27:25.000Z"), accountId: "a" };
  const other = { ...message("other", "2026-10-27T11:27:15.000Z"), accountId: "b" };
  const merged = mergeMessagesByTime([reply, out], [other, before]);
  assert.deepEqual(merged, [before, out, other, reply]);
  assert.equal(mergeMessagesByTime(merged, []), merged, "keep stable references for an already ordered buffer");
});
