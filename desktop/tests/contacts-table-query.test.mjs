import test from "node:test";
import assert from "node:assert/strict";
import {
  createDefaultContactsFilter,
  queryContactsTable,
} from "../src/lib/contactsTableQuery.ts";

const NOW_MS = Date.parse("2026-11-24T00:00:00.000Z");

const SAMPLE_CONTACTS = [
  {
    id: "c-1",
    name: "Alice Kinshasa",
    phone: "+243810000001",
    company: "Congo Trade",
    accountId: "wa-a",
    tags: ["VIP", "Wholesale"],
    stage: "quoting",
    lastMessageAt: "2026-11-22T10:00:00.000Z",
  },
  {
    id: "c-2",
    name: "Bob Abidjan",
    phone: "+225070000002",
    accountId: "wa-a",
    tags: ["Wholesale"],
    stage: "new",
    lastMessageAt: "2026-11-01T10:00:00.000Z",
  },
  {
    id: "c-3",
    name: "Charlie Douala",
    phone: "+237650000003",
    accountId: "wa-b",
    tags: ["Cold"],
    stage: "won",
  },
  {
    id: "g-1",
    name: "Internal Group",
    phone: "",
    channelAddress: "120363001@g.us",
    isGroup: true,
    accountId: "wa-a",
    tags: [],
    stage: "new",
  },
];

const SAMPLE_FOLLOWUPS = [
  {
    id: "f-1",
    contactId: "c-2",
    contactName: "Bob Abidjan",
    dueAt: "2026-11-25",
    note: "Send price list",
    done: false,
  },
];

test("queryContactsTable filters by account, stage, tag, inactivity, and pending follow-up", () => {
  const base = queryContactsTable({
    contacts: SAMPLE_CONTACTS,
    chats: [],
    followUps: SAMPLE_FOLLOWUPS,
    filter: createDefaultContactsFilter(""),
    liveAccountId: "wa-a",
    nowMs: NOW_MS,
  });
  assert.equal(base.totalPeopleCount, 3);
  assert.deepEqual(base.availableTags, ["Wholesale", "Cold", "VIP"]);
  assert.equal(base.pendingFollowUpCount, 1);

  const inactive14 = queryContactsTable({
    contacts: SAMPLE_CONTACTS,
    chats: [],
    followUps: SAMPLE_FOLLOWUPS,
    filter: { ...createDefaultContactsFilter("wa-a"), inactiveDays: "14" },
    liveAccountId: "wa-a",
    nowMs: NOW_MS,
  });
  assert.deepEqual(
    inactive14.rows.map((row) => row.contact.id),
    ["c-2"]
  );

  const followUpOnly = queryContactsTable({
    contacts: SAMPLE_CONTACTS,
    chats: [],
    followUps: SAMPLE_FOLLOWUPS,
    filter: { ...createDefaultContactsFilter(""), onlyWithFollowUp: true },
    liveAccountId: "wa-a",
    nowMs: NOW_MS,
  });
  assert.deepEqual(
    followUpOnly.rows.map((row) => row.contact.id),
    ["c-2"]
  );
});

test("queryContactsTable sorts by stage order, name, and enriches lastActiveAt from chats", () => {
  const chats = [
    {
      id: "bridge-chat-c-3",
      contactId: "c-3",
      contactName: "Charlie Douala",
      lastMessage: "Paid",
      unread: 0,
      updatedAt: "2026-11-23T18:00:00.000Z",
      phoneId: "wa-b",
      accountId: "wa-b",
      hasMessageHistory: true,
    },
  ];

  const byLastMessage = queryContactsTable({
    contacts: SAMPLE_CONTACTS,
    chats,
    followUps: [],
    filter: { ...createDefaultContactsFilter(""), sortBy: "lastMessage", sortDir: "desc" },
    liveAccountId: "wa-a",
    nowMs: NOW_MS,
  });
  assert.deepEqual(
    byLastMessage.rows.map((row) => row.contact.id),
    ["c-3", "c-1", "c-2"]
  );

  const byStageAsc = queryContactsTable({
    contacts: SAMPLE_CONTACTS,
    chats,
    followUps: [],
    filter: { ...createDefaultContactsFilter(""), sortBy: "stage", sortDir: "asc" },
    stageOrder: ["new", "contacted", "quoting", "won", "after_sales"],
    liveAccountId: "wa-a",
    nowMs: NOW_MS,
  });
  assert.deepEqual(
    byStageAsc.rows.map((row) => row.contact.id),
    ["c-2", "c-1", "c-3"]
  );
});
