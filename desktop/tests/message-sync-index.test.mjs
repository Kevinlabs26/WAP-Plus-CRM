import assert from "node:assert/strict";
import test from "node:test";
import {
  accountMessageIndexKey,
  createMessageSyncIndex,
  messageMatchesAccountAlias,
  reuseMessageSyncIndex,
  setMessageIndexAlias,
} from "../src/store/messageSyncIndex.ts";

test("message sync index maps ids and is reused for the same source", () => {
  const messages = [
    {
      id: "one",
      waMessageId: "wa-one",
      accountId: "account-a",
      direction: "in",
      chatId: "chat-a",
    },
    { id: "two", waKey: { id: "key-two" }, direction: "out", chatId: "chat-a" },
  ];
  const index = createMessageSyncIndex(messages);

  assert.equal(index.byId.get("one"), 0);
  assert.equal(index.byId.get("wa-one"), 0);
  assert.equal(index.byId.get(accountMessageIndexKey("account-a", "wa-one")), 0);
  assert.equal(index.byId.get("key-two"), 1);
  assert.deepEqual(index.inboundByChat.get("chat-a"), [0]);
  assert.equal(reuseMessageSyncIndex(index, messages), index);
  assert.notEqual(reuseMessageSyncIndex(index, [...messages]), index);
});

test("legacy reaction cleanup matches only the source account and id alias", () => {
  const source = {
    id: "local-a",
    accountId: "account-a",
    chatId: "chat-a",
    direction: "in",
    waMessageId: "reaction-1",
  };
  assert.equal(
    messageMatchesAccountAlias(source, "account-a", "reaction-1"),
    true
  );
  assert.equal(
    messageMatchesAccountAlias(source, "account-b", "reaction-1"),
    false
  );
  assert.equal(
    messageMatchesAccountAlias(source, "account-a", "reaction-2"),
    false
  );
});

test("dynamic message aliases are indexed globally and by account", () => {
  const index = new Map();
  setMessageIndexAlias(index, "account-a", "wa-echo", 4);
  assert.equal(index.get("wa-echo"), 4);
  assert.equal(index.get(accountMessageIndexKey("account-a", "wa-echo")), 4);
});
