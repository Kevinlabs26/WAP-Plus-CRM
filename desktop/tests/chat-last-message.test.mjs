import assert from "node:assert/strict";
import { extractChatLastMessages } from "../baileys-bridge/messageIngest.mjs";

const first = {
  key: { id: "m1", remoteJid: "123@s.whatsapp.net", fromMe: true },
  message: { conversation: "hello" },
};
const newerCopy = {
  key: { id: "m1", remoteJid: "123@s.whatsapp.net", fromMe: true },
  message: { conversation: "hello, updated" },
};

const recovered = extractChatLastMessages([
  { id: "123@s.whatsapp.net", lastMsg: first },
  { id: "missing-message", lastMsg: { key: { id: "m2" } } },
  { id: "missing-key", lastMsg: { message: { conversation: "skip" } } },
  { id: "duplicate", lastMsg: newerCopy },
]);

assert.equal(recovered.length, 1);
assert.equal(recovered[0], newerCopy);
assert.equal(extractChatLastMessages(null).length, 0);

console.log("chat last message recovery: ok");
