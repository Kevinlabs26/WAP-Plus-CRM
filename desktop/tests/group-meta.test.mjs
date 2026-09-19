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
