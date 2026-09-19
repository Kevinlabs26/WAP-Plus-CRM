import assert from "node:assert/strict";
import { openJoinedGroup } from "../src/components/chat/openJoinedGroup.ts";

let events = [];
let opened = "";
const ok = openJoinedGroup({
  accountId: "wa-1",
  groupJid: "123@g.us",
  group: { jid: "123@g.us", subject: "测试群", participantCount: 8 },
  ingest: (next) => {
    events = next;
  },
  findContactId: () => "group-contact",
  openContact: (id) => {
    opened = id;
  },
});

assert.equal(ok, true);
assert.equal(opened, "group-contact");
assert.equal(events[0]?.type, "contacts.sync");
assert.equal(events[0]?.payload?.items?.[0]?.jid, "123@g.us");
assert.equal(events[0]?.payload?.items?.[0]?.displayName, "测试群");
assert.equal(events[0]?.payload?.items?.[0]?.isGroup, true);

console.log("joinedGroup ok");
