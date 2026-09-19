import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createChatIdLookup,
  createContactLookup,
} from "../src/store/contactIndex.ts";

function contact(over = {}) {
  return {
    id: "bridge-contact-x",
    name: "x",
    phone: "",
    channelAddress: "",
    tags: [],
    stage: "new",
    personKey: "",
    accountId: "wa-a",
    ...over,
  };
}

test("contact lookup finds by phone, channel and id", () => {
  const contacts = [
    contact({ id: "c1", phone: "+331111", channelAddress: "p1@s.whatsapp.net" }),
    contact({ id: "c2", phone: "+332222", channelAddress: "lid-2@lid" }),
  ];
  const lookup = createContactLookup(contacts);
  assert.equal(lookup.matchIndex({ deviceId: "wa-a", phone: "+331111" }), 0);
  assert.equal(
    lookup.matchIndex({ deviceId: "wa-a", channelAddress: "lid-2@lid" }),
    1
  );
  assert.equal(
    lookup.matchIndex({ deviceId: "wa-a", jid: "p1@s.whatsapp.net" }),
    0
  );
  assert.equal(lookup.idIndex("c2"), 1);
});

test("contact lookup scopes by account owner", () => {
  const contacts = [contact({ id: "c1", phone: "+331111", accountId: "wa-a" })];
  const lookup = createContactLookup(contacts);
  assert.equal(lookup.matchIndex({ deviceId: "wa-b", phone: "+331111" }), -1);
});

test("contact lookup follows appended contacts (length-versioned rebuild)", () => {
  const contacts = [contact({ id: "c1", phone: "+331111" })];
  const lookup = createContactLookup(contacts);
  assert.equal(lookup.matchIndex({ deviceId: "wa-a", phone: "+331111" }), 0);
  contacts.push(contact({ id: "c2", phone: "+339999" }));
  assert.equal(lookup.matchIndex({ deviceId: "wa-a", phone: "+339999" }), 1);
});

test("contact lookup pnJid normalizes to phone and channel", () => {
  const contacts = [
    contact({ id: "c1", phone: "+3311111", channelAddress: "lid-9@lid" }),
  ];
  const lookup = createContactLookup(contacts);
  assert.equal(
    lookup.matchIndex({ deviceId: "wa-a", pnJid: "3311111@s.whatsapp.net" }),
    0
  );
  assert.equal(lookup.matchIndex({ deviceId: "wa-a", pnJid: "lid-9@lid" }), 0);
});

test("stale key after replace falls back without false positive", () => {
  const contacts = [contact({ id: "c1", phone: "+331111" })];
  const lookup = createContactLookup(contacts);
  // 先触发一次查找，让索引在旧 phone 上建好
  assert.equal(lookup.matchIndex({ deviceId: "wa-a", phone: "+331111" }), 0);
  contacts[0] = { ...contacts[0], phone: "+337777" };
  // 旧 phone 键指向的元素已不匹配 → 不得误命中
  assert.equal(lookup.matchIndex({ deviceId: "wa-a", phone: "+331111" }), -1);
  // 新 phone 未建索引 → -1（与原始 findIndex 语义一致）
  assert.equal(lookup.matchIndex({ deviceId: "wa-a", phone: "+337777" }), -1);
});

test("chat id lookup versions on reference and length", () => {
  const chats = [
    {
      id: "chat-1",
      contactId: "c1",
      contactName: "a",
      lastMessage: "",
      unread: 0,
      updatedAt: "",
      phoneId: "wa-a",
      accountId: "wa-a",
    },
  ];
  const lookup = createChatIdLookup();
  assert.equal(lookup.idx(chats, "chat-1"), 0);
  assert.equal(lookup.idx(chats, "nope"), -1);
  chats.push({
    id: "chat-2",
    contactId: "c2",
    contactName: "b",
    lastMessage: "",
    unread: 0,
    updatedAt: "",
    phoneId: "wa-a",
    accountId: "wa-a",
  });
  assert.equal(lookup.idx(chats, "chat-2"), 1);
});
