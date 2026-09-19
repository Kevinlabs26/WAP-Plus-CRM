import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";
import { fileURLToPath } from "node:url";

const { outputFiles } = buildSync({
  entryPoints: [fileURLToPath(new URL("../src/lib/todayBoard.ts", import.meta.url))],
  bundle: true, format: "esm", platform: "node", write: false,
});
const { scopeTodayBoard, listRecentFailedOutbound, listUnreadChats } =
  await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);

test("account scope respects explicit ownership and legacy fallbacks", () => {
  const data = {
    contacts: [{ id: "a", accountId: "A" }, { id: "b", boundPhoneId: "B" }],
    chats: [{ id: "ca", contactId: "a", phoneId: "A" }, { id: "cb", contactId: "b", accountId: "B" }],
    followUps: [{ id: "fa", contactId: "a" }, { id: "fb", contactId: "b" }, { id: "fu", contactId: "unknown" }],
    messages: [{ id: "ma", chatId: "ca" }, { id: "mb", chatId: "cb" },
      { id: "explicit", chatId: "ca", accountId: "B" }, { id: "legacy", deviceId: "A" }, { id: "unknown" }],
  };
  const a = scopeTodayBoard(data, "A");
  assert.deepEqual(a.chats.map(x => x.id), ["ca"]);
  assert.deepEqual(a.followUps.map(x => x.id), ["fa"]);
  assert.deepEqual(a.messages.map(x => x.id), ["ma", "legacy"]);
  assert.equal(scopeTodayBoard(data), data);
  assert.equal(scopeTodayBoard(data, "missing").messages.length, 0);
});

test("complete queue counts exceed preview limits and update after resolution", () => {
  const messages = Array.from({ length: 45 }, (_, i) => ({
    id: String(i), direction: "out", deliveryStatus: "failed", sentAt: new Date().toISOString(),
  }));
  messages.push({ id: "old", direction: "out", deliveryStatus: "failed", sentAt: "2020-01-01T00:00:00Z" });
  assert.equal(listRecentFailedOutbound(messages, [], { limit: Infinity }).length, 45);
  const chats = Array.from({ length: 40 }, (_, i) => ({ id: String(i), unread: 2 }));
  assert.equal(listUnreadChats(chats, Infinity).length, 40);
  messages[0].deliveryStatus = "sent";
  chats[0].unread = 0;
  assert.equal(listRecentFailedOutbound(messages, [], { limit: Infinity }).length, 44);
  assert.equal(listUnreadChats(chats, Infinity).length, 39);
});
