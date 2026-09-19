import assert from "node:assert/strict";
import {
  bucketFollowUpsForToday,
  listUnreadChats,
  summarizeToday,
  followUpDayKey,
  listRecentFailedOutbound,
} from "../src/lib/todayBoard.ts";

assert.equal(followUpDayKey("2026-08-03T10:00:00.000Z").length, 10);

const fus = [
  { id: "1", contactId: "c1", contactName: "A", dueAt: "2026-08-01", done: false },
  { id: "2", contactId: "c2", contactName: "B", dueAt: "2026-08-03", done: false },
  { id: "3", contactId: "c3", contactName: "C", dueAt: "2026-08-05", done: false },
  { id: "4", contactId: "c4", contactName: "D", dueAt: "2026-08-02", done: true },
];
const b = bucketFollowUpsForToday(fus, "2026-08-03");
assert.equal(b.overdue.length, 1);
assert.equal(b.overdue[0].id, "1");
assert.equal(b.dueToday.length, 1);
assert.equal(b.actionable.length, 2);

const unread = listUnreadChats(
  [
    {
      id: "ch1",
      contactId: "c1",
      contactName: "A",
      lastMessage: "hi",
      unread: 2,
      updatedAt: "2026-08-03T12:00:00",
      phoneId: "p",
    },
    {
      id: "ch2",
      contactId: "c2",
      contactName: "B",
      lastMessage: "",
      unread: 0,
      updatedAt: "2026-08-03T13:00:00",
      phoneId: "p",
    },
    {
      id: "ch3",
      contactId: "c3",
      contactName: "C",
      lastMessage: "yo",
      unread: 1,
      updatedAt: "2026-08-03T11:00:00",
      phoneId: "p",
    },
  ],
  10
);
assert.equal(unread.length, 2);
assert.equal(unread[0].id, "ch1");

const sum = summarizeToday({
  followUps: fus,
  chats: [
    {
      id: "ch1",
      contactId: "c1",
      contactName: "A",
      lastMessage: "",
      unread: 2,
      updatedAt: "",
      phoneId: "p",
    },
    {
      id: "ch2",
      contactId: "c2",
      contactName: "B",
      lastMessage: "",
      unread: 0,
      updatedAt: "",
      phoneId: "p",
    },
  ],
  failedCount: 1,
  attentionAccountCount: 1,
  today: "2026-08-03",
});
assert.equal(sum.overdueCount, 1);
assert.equal(sum.dueTodayCount, 1);
assert.equal(sum.unreadChatCount, 1);
assert.ok(sum.attentionScore > 0);

const failed = listRecentFailedOutbound(
  [
    {
      id: "m1",
      chatId: "ch1",
      contactId: "c1",
      direction: "out",
      body: "x",
      sentAt: new Date().toISOString(),
      deliveryStatus: "failed",
    },
    {
      id: "m2",
      chatId: "ch1",
      contactId: "c1",
      direction: "out",
      body: "y",
      sentAt: new Date().toISOString(),
      deliveryStatus: "sent",
    },
  ],
  [{ id: "c1", name: "Alice" }],
  { limit: 5 }
);
assert.equal(failed.length, 1);
assert.equal(failed[0].contactName, "Alice");

console.log("today-board.test.mjs ok");
