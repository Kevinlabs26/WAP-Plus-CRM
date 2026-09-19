import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";
import { fileURLToPath } from "node:url";
import { isRetryableOutgoing } from "../src/store/outgoingRetry.ts";

const result = buildSync({ entryPoints: [fileURLToPath(new URL("../src/store/hydrateMessageCleanup.ts", import.meta.url))], bundle: true, format: "esm", write: false });
const { cleanHydratedMessages, recoverInterruptedMessage } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
const message = { id: "wa-1", waMessageId: "wa-1", accountId: "a", chatId: "chat", direction: "out", body: "OK", phoneE164: "+12025550100", deliveryStatus: "sent", sentAt: "2026-09-05T10:00:00Z" };

test("identical texts with distinct IDs survive restart, including local messages", () => {
  for (const remote of [true, false]) {
    const first = { ...message, waMessageId: remote ? "wa-1" : undefined };
    const second = { ...first, id: "wa-2", waMessageId: remote ? "wa-2" : undefined, sentAt: "2026-09-05T10:01:00Z" };
    assert.equal(cleanHydratedMessages([first, second]).length, 2);
  }
});

test("same protocol ID is deduplicated only within the same account", () => {
  assert.equal(cleanHydratedMessages([message, { ...message, id: "local-copy" }]).length, 1);
  assert.equal(cleanHydratedMessages([message, { ...message, accountId: "b" }]).length, 2);
});

test("interrupted text and media require manual verification and never auto-retry", () => {
  for (const mediaType of [undefined, "image"]) {
    const recovered = recoverInterruptedMessage({ ...message, deliveryStatus: "pending", mediaType, nextAttemptAt: "2020-01-01" });
    assert.equal(recovered.deliveryStatus, "failed");
    assert.equal(recovered.nextAttemptAt, undefined);
    assert.equal(isRetryableOutgoing(recovered), false);
    assert.match(recovered.lastError, /核对/);
  }
  const queued = { ...message, deliveryStatus: "queued" };
  assert.equal(recoverInterruptedMessage(queued), queued);
  assert.equal(isRetryableOutgoing(queued), true);
});
