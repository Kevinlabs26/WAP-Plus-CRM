import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { fileURLToPath } from "node:url";

const result = buildSync({
  entryPoints: [fileURLToPath(new URL("../src/lib/leadInbox.ts", import.meta.url))],
  bundle: true,
  format: "esm",
  platform: "neutral",
  write: false,
});
const moduleUrl = `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`;
const { leadCandidateForChat, leadDateBucket } = await import(moduleUrl);

const settings = {
  enabled: true,
  statusFilter: "pending",
  includeGroups: false,
  dateGrouping: "day",
  dateRangeDays: 0,
  accountScope: "view",
  selectedAccountIds: [],
  mergeAccounts: true,
  sort: "first_contact",
  captureSince: "",
};
const chat = {
  id: "chat-1",
  contactId: "contact-1",
  contactName: "Marie",
  lastMessage: "Bonjour",
  unread: 1,
  updatedAt: "2026-09-20T10:00:00.000Z",
  phoneId: "wa-a",
};

const inbound = {
  id: "m-1",
  chatId: "chat-1",
  direction: "in",
  body: "Bonjour",
  sentAt: "2026-09-20T10:00:00.000Z",
};
assert.equal(
  leadCandidateForChat(chat, undefined, [inbound], settings, "wa-a").status,
  "pending"
);
assert.equal(
  leadCandidateForChat(
    chat,
    undefined,
    [inbound, { ...inbound, id: "m-2", direction: "out", sentAt: "2026-09-20T10:01:00.000Z" }],
    settings,
    "wa-a"
  ).status,
  "replied"
);
assert.equal(
  leadCandidateForChat(
    { ...chat, isGroup: true },
    { id: "group-1", name: "Group", phone: "", tags: [], stage: "new", isGroup: true },
    [inbound],
    settings,
    "wa-a"
  ),
  null
);
assert.equal(leadDateBucket("2026-09-20T10:00:00.000Z", "day"), "2026-09-20");
assert.equal(leadDateBucket("2026-09-20T10:00:00.000Z", "month"), "2026-09");

console.log("lead-inbox.test.mjs ok");
