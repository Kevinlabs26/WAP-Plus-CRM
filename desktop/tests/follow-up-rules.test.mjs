import assert from "node:assert/strict";
import {
  autoFollowUpId,
  isAutoFollowUpId,
  resolveFollowUpRules,
  ruleMatches,
} from "../src/lib/followUpRules.ts";

const now = Date.parse("2026-08-06T12:00:00.000Z");

assert.equal(
  ruleMatches(
    {
      id: "inbound_no_reply",
      title: "inbound",
      afterHours: 4,
      noteTemplate: "x",
      kind: "inbound_no_reply",
    },
    { contactId: "c1", lastDirection: "in", lastAt: "2026-08-06T07:00:00.000Z" },
    now
  ),
  true
);
assert.equal(
  ruleMatches(
    {
      id: "inbound_no_reply",
      title: "inbound",
      afterHours: 4,
      noteTemplate: "x",
      kind: "inbound_no_reply",
    },
    { contactId: "c1", lastDirection: "out", lastAt: "2026-08-06T07:00:00.000Z" },
    now
  ),
  false
);

const rules = resolveFollowUpRules([
  { id: "inbound_no_reply", enabled: false, afterHours: 0 },
  { id: "outbound_no_answer", enabled: true, afterHours: 999 },
]);
assert.equal(rules.some((r) => r.id === "inbound_no_reply"), false);
assert.equal(rules.find((r) => r.id === "outbound_no_answer")?.afterHours, 168);

const id = autoFollowUpId("inbound_no_reply", "c1");
assert.equal(isAutoFollowUpId(id), true);
assert.equal(isAutoFollowUpId("manual-c1"), false);

console.log("follow-up-rules.test.mjs ok");
