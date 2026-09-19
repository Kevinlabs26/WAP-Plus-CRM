import assert from "node:assert/strict";
import test from "node:test";
import { applyMessagesDelete } from "../src/store/messagesDeleteIngest.ts";

const messages = [
  {
    id: "a-local",
    chatId: "chat-a",
    accountId: "account-a",
    direction: "in",
    body: "A",
    sentAt: "2026-08-12T10:00:00.000Z",
    waKey: {
      id: "shared-key",
      remoteJid: "111@s.whatsapp.net",
      fromMe: false,
    },
  },
  {
    id: "b-local",
    chatId: "chat-b",
    accountId: "account-b",
    direction: "in",
    body: "B",
    sentAt: "2026-08-12T10:00:00.000Z",
    waKey: {
      id: "shared-key",
      remoteJid: "111@s.whatsapp.net",
      fromMe: false,
    },
  },
];

test("message delete only affects the source account", () => {
  const result = applyMessagesDelete(
    messages,
    [],
    { items: [{ id: "shared-key" }] },
    { deviceId: "account-a" }
  );
  assert.deepEqual(result.messages.map((message) => message.id), ["b-local"]);
});
