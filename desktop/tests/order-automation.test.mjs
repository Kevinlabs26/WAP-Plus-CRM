import assert from "node:assert/strict";
import { applyOrderAutomation } from "../src/store/orderAutomation.ts";

const contact = {
  id: "c1",
  name: "Alice",
  phone: "+12025550123",
  tags: [],
  stage: "new",
};
const order = {
  id: "wa-order-1",
  waMessageId: "wa-order-1",
  chatId: "chat-1",
  contactId: "c1",
  direction: "in",
  body: "[\u8ba2\u5355] 2 \u4ef6 EUR 12.50\nWidget \u00d72",
  mediaType: "order",
  sentAt: "2026-08-01T12:00:00.000Z",
};

const first = applyOrderAutomation(
  [contact],
  [],
  [],
  [order],
  new Date(2026, 7, 1)
);
assert.equal(first.contacts[0].stage, "quoting");
assert.equal(first.contacts[0].nextFollowUpAt, "2026-08-02");
assert.equal(first.followUps.length, 1);
assert.equal(first.activities.length, 1);

const second = applyOrderAutomation(
  first.contacts,
  first.followUps,
  first.activities,
  [order],
  new Date(2026, 7, 1)
);
assert.equal(second.followUps.length, 1);
assert.equal(second.activities.length, 1);

console.log("order-automation.test.mjs ok");
