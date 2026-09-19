import assert from "node:assert/strict";
import test from "node:test";
import { queueTextMessage } from "../src/components/chat/queueTextMessage.ts";

test("queued text stays attached to the requested multi-window chat", () => {
  let queued;
  const ok = queueTextMessage({
    text: "bonjour",
    chatId: "chat-b",
    recipient: "33600000000",
    contactId: "contact-b",
    channelId: "baileys",
    deviceId: null,
    accountId: "account-b",
    softReconnect: false,
    needsScan: false,
    enqueueOutgoingMessage: (input) => {
      queued = input;
      return "message-b";
    },
    pushToast: () => undefined,
    setBaileysLoginOpen: () => undefined,
  });

  assert.equal(ok, "message-b");
  assert.equal(queued.chatId, "chat-b");
  assert.equal(queued.contactId, "contact-b");
  assert.equal(queued.accountId, "account-b");
});
