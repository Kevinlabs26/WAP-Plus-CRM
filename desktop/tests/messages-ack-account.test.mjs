import assert from "node:assert/strict";
import test from "node:test";
import { applyMessagesAck } from "../src/store/bridgeIngestHelpers.ts";

test("delivery ack only updates the source account", () => {
  const messages = [
    {
      id: "a-local",
      accountId: "account-a",
      chatId: "chat-a",
      direction: "out",
      body: "A",
      sentAt: "2026-08-12T10:00:00.000Z",
      deliveryStatus: "sent",
      waMessageId: "shared-key",
    },
    {
      id: "b-local",
      accountId: "account-b",
      chatId: "chat-b",
      direction: "out",
      body: "B",
      sentAt: "2026-08-12T10:00:00.000Z",
      deliveryStatus: "sent",
      waMessageId: "shared-key",
    },
  ];

  const result = applyMessagesAck(
    messages,
    [{ id: "shared-key", ack: "read" }],
    undefined,
    "account-a"
  );
  assert.equal(result[0].deliveryStatus, "read");
  assert.equal(result[1].deliveryStatus, "sent");
});
