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
