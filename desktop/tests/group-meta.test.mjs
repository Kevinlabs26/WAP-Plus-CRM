import test from "node:test";
import assert from "node:assert/strict";
import {
  extractInviteCode,
  formatParticipantUpdateBody,
  normalizeGroupMetadata,
} from "../baileys-bridge/groupMeta.mjs";

test("extractInviteCode from url and raw", () => {
  assert.equal(
    extractInviteCode("https://chat.whatsapp.com/AbCdEfGh123"),
    "AbCdEfGh123"
  );
  assert.equal(extractInviteCode("AbCdEfGh123"), "AbCdEfGh123");
  assert.equal(extractInviteCode("not a code"), "");
});

test("normalizeGroupMetadata participants roles", () => {
  const g = normalizeGroupMetadata({
    id: "120363@g.us",
    subject: "客户群",
    desc: "简介",
    owner: "owner@s.whatsapp.net",
    announce: true,
    participants: [
      { id: "a@s.whatsapp.net", admin: "superadmin" },
      { id: "b@s.whatsapp.net", admin: "admin" },
      { id: "c@s.whatsapp.net" },
    ],
  });
  assert.equal(g.jid, "120363@g.us");
  assert.equal(g.subject, "客户群");
  assert.equal(g.desc, "简介");
  assert.equal(g.announce, true);
  assert.equal(g.participantCount, 3);
  assert.equal(g.participants[0].role, "superadmin");
  assert.equal(g.participants[1].isAdmin, true);
  assert.equal(g.participants[2].role, "member");
});

test("formatParticipantUpdateBody", () => {
  const body = formatParticipantUpdateBody(
    { action: "add", participants: ["1@s.whatsapp.net"], author: "2@s.whatsapp.net" },
    (j) => (j.startsWith("1") ? "Alice" : "Bob")
  );
  assert.match(body, /Alice/);
  assert.match(body, /加入/);
});

test("membership previews never display an unknown LID as a phone number", () => {
  const body = formatParticipantUpdateBody({
    action: "add",
    participants: ["123456789001@lid"],
    author: "12025550123@s.whatsapp.net",
  });
  assert.doesNotMatch(body, /123456789001/);
  assert.match(body, /\+12025550123/);
});

test("removed members use the event phone, cached identity or stored LID mapping", async () => {
  const { attachGroupParticipantEvents } = await import("../baileys-bridge/groupEvents.mjs");
  const { EventEmitter } = await import("node:events");
  const ev = new EventEmitter();
  const sync = new Promise((resolve) => {
    attachGroupParticipantEvents({ ev, groupMetadata: async () => undefined }, {
      contacts: new Map(),
      messages: new Map(),
      upsertContact: () => null,
      getCachedParticipants: () => [{ id: "2@lid", phoneNumber: "12025550102@s.whatsapp.net" }],
      resolvePnJid: async (jid) => jid === "3@lid" ? "12025550103@s.whatsapp.net" : "",
      push: (_event, payload) => resolve(payload.items[0]),
    });
  });
  ev.emit("group-participants.update", {
    id: "120363@g.us",
    action: "remove",
    participants: [{ id: "1@lid", phoneNumber: "12025550101@s.whatsapp.net" }, "2@lid", "3@lid", "4@lid"],
    author: "5@lid",
    authorPn: "12025550105@s.whatsapp.net",
  });
  const message = await sync;
  assert.deepEqual(message.systemParticipants, ["12025550101@s.whatsapp.net", "12025550102@s.whatsapp.net", "12025550103@s.whatsapp.net", "4@lid"]);
  assert.equal(message.systemAuthor, "12025550105@s.whatsapp.net");
  assert.match(message.body, /\+12025550101/);
});
