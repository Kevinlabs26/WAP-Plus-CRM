import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { fileURLToPath } from "node:url";

const result = buildSync({
  stdin: { contents: `export * from './src/lib/leadInbox.ts';
    export { backfillChatPreviewFromMessages } from './src/store/chatReconcile.ts';
    export { parseBackupJson } from './src/lib/exportData.ts';`,
    resolveDir: fileURLToPath(new URL('../', import.meta.url)) },
  bundle: true,
  format: "esm",
  platform: "neutral",
  write: false,
});
const moduleUrl = `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`;
const { leadCandidateForChat, leadCandidatesForChats, leadDateBucket, earliestConversationMessage, backfillChatPreviewFromMessages, parseBackupJson } = await import(moduleUrl);

const settings = {
  enabled: true,
  includeGroups: false,
  dateGrouping: "day",
  dateRangeDays: 0,
  accountScope: "view",
  selectedAccountIds: [],
  mergeAccounts: true,
  sort: "first_contact",
  removeAfterReply: false,
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
  leadCandidateForChat(chat, undefined, [inbound], settings, "wa-a")?.chatId,
  "chat-1"
);
assert.equal(
  leadCandidateForChat(
    chat,
    undefined,
    [inbound, { ...inbound, id: "m-2", direction: "out", sentAt: "2026-09-20T10:01:00.000Z" }],
    settings,
    "wa-a"
  )?.chatId,
  "chat-1"
);
assert.equal(
  leadCandidateForChat(
    chat,
    undefined,
    [
      { ...inbound, id: "m-before", direction: "out", sentAt: "2026-09-20T09:59:00.000Z" },
      inbound,
    ],
    settings,
    "wa-a"
  ),
  null
);
assert.equal(
  leadCandidateForChat(
    { ...chat, hasOutgoingHistory: true },
    undefined,
    [inbound],
    settings,
    "wa-a"
  )?.chatId,
  "chat-1"
);
assert.equal(
  leadCandidateForChat(
    chat,
    undefined,
    [
      { ...inbound, id: "m-0", direction: "out", deliveryStatus: "failed" },
      inbound,
    ],
    settings,
    "wa-a"
  )?.chatId,
  "chat-1"
);
assert.equal(
  leadCandidateForChat(
    chat,
    undefined,
    [
      inbound,
      { ...inbound, id: "m-3", direction: "out", sentAt: "2026-09-20T10:01:00.000Z" },
    ],
    { ...settings, removeAfterReply: true },
    "wa-a"
  ),
  null
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

const oldAt = "2026-08-01T10:00:00.000Z";
const first = { at: oldAt, direction: "out" };
assert.equal(leadCandidateForChat({ ...chat, firstConversationMessage: first }, undefined, [inbound], settings, 'wa-a'), null);
assert.equal(leadCandidateForChat({ ...chat, firstConversationMessage: { ...first, direction: 'in' } }, undefined, [], settings, 'wa-a').firstInboundAt, oldAt);
for (const deliveryStatus of ['failed', 'pending', 'queued', 'local']) {
  assert.equal(earliestConversationMessage(undefined, { ...inbound, direction: 'out', deliveryStatus }), undefined);
}
assert.equal(earliestConversationMessage(undefined, { ...inbound, direction: 'out', deliveryStatus: 'sent', deliveryUncertain: true }), undefined);
assert.equal(earliestConversationMessage(undefined, { ...inbound, systemKind: 'group_participants' }), undefined);
assert.equal(earliestConversationMessage({at: inbound.sentAt, direction: 'in'}, {...inbound, direction: 'out'}).direction, 'out');

const contacts = new Map([
  ['contact-1', { id: 'contact-1', phone: '+33 1 23 45 67 89', personKey: 'old-lid' }],
  ['contact-2', { id: 'contact-2', phone: '33123456789', personKey: 'new-lid' }],
]);
const other = { ...chat, id: 'chat-2', contactId: 'contact-2', accountId: 'wa-b', phoneId: 'wa-b' };
const latest = { ...inbound, id: 'm-2', chatId: other.id, accountId: 'wa-b' };
const collect = (chats, messages, overrides = {}) => leadCandidatesForChats(chats, contacts, messages, { ...settings, ...overrides }, 'wa-a');

// Account filters and display merging cannot hide prior contact on another account.
const oldOutbound = {...chat, firstConversationMessage: first, hasOutgoingHistory: true};
for (const mergeAccounts of [true, false]) {
  assert.equal(collect([oldOutbound, other], {[other.id]: [latest]}, {accountScope: 'selected', selectedAccountIds: ['wa-b'], mergeAccounts}).size, 0);
}
const originalLead = {...chat, firstConversationMessage: {...first, direction: 'in'}};
let leads = collect([originalLead, other], {[other.id]: [latest]});
assert.deepEqual([...leads.keys()], [chat.id]);
assert.equal(leads.get(chat.id).firstInboundAt, oldAt);
assert.equal(collect([originalLead, {...other, hasOutgoingHistory: true}], {[other.id]: [latest]}, {removeAfterReply: true}).size, 0);
assert.equal(collect([{...chat, hasMessageHistory: true}, other], {[other.id]: [latest]}).size, 0);
assert.deepEqual([...collect([chat, other], {[other.id]: [latest]}).keys()], [other.id]);
assert.equal(collect([originalLead], {}, {captureSince: inbound.sentAt}).size, 0);

// A foreign-account message in the same buffer is not evidence for this chat.
assert.equal(leadCandidateForChat(chat, undefined, [{...inbound, accountId: 'wa-b'}], settings, 'wa-a'), null);
const oldMessage = {...inbound, id: 'old', sentAt: oldAt, direction: 'out', systemKind: 'scheduled_plan', deliveryStatus: 'sent'};
const reconciled = backfillChatPreviewFromMessages([chat], [inbound, oldMessage])[0];
assert.deepEqual(reconciled.firstConversationMessage, first);
assert.equal(leadCandidateForChat(reconciled, undefined, [inbound], settings, 'wa-a'), null);
assert.equal(backfillChatPreviewFromMessages([reconciled], [inbound])[0].firstConversationMessage.at, oldAt);
const restored = parseBackupJson({version:2, contacts:[...contacts.values()], chats:[reconciled]});
assert.deepEqual(restored.chats[0].firstConversationMessage, first);
assert.equal(parseBackupJson({version:2, contacts:[...contacts.values()], chats:[{...reconciled,firstConversationMessage:{at:'bad', direction:'in'}}]}).chats[0].firstConversationMessage, undefined);
console.log('lead-inbox cross-account and cold-history regressions ok');
