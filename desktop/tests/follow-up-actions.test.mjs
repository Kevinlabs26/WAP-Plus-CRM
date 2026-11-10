import assert from "node:assert/strict";
import { createFollowUpActions } from "../src/store/followUpActions.ts";

let state = {
  contacts: [
    { id: "c1", name: "甲", nextFollowUpAt: undefined },
    { id: "c2", name: "乙", nextFollowUpAt: undefined },
  ],
  followUps: [
    { id: "f1", contactId: "c1", contactName: "甲", dueAt: "2026-08-12", note: "保留", done: false },
  ],
};
let persisted = 0;
let recomputed = 0;
const actions = createFollowUpActions({
  getState: () => state,
  setState: (update) => {
    state = { ...state, ...update(state) };
  },
  logActivity: () => {},
  recomputeStats: () => { recomputed += 1; },
  persist: () => { persisted += 1; },
  pushToast: () => {},
});

assert.equal(actions.scheduleFollowUps(["c1", "c2", "missing"], "2026-08-20"), 2);
assert.equal(state.contacts[0].nextFollowUpAt, "2026-08-20");
assert.equal(state.contacts[1].nextFollowUpAt, "2026-08-20");
assert.equal(state.followUps.find((item) => item.contactId === "c1").note, "保留");
assert.equal(state.followUps.find((item) => item.contactId === "c2").dueAt, "2026-08-20");
assert.equal(persisted, 1);
assert.equal(recomputed, 1);

actions.toggleFollowUp("f1");
assert.equal(state.followUps.find((item) => item.id === "f1").done, true);
assert.equal(state.contacts.find((item) => item.id === "c1").nextFollowUpAt, undefined);

actions.toggleFollowUp("f1");
assert.equal(state.followUps.find((item) => item.id === "f1").done, false);
assert.equal(state.contacts.find((item) => item.id === "c1").nextFollowUpAt, "2026-08-20");

const beforeBulkPersist = persisted;
assert.equal(actions.completeFollowUps(["f1", "missing"]), 1);
assert.equal(state.followUps.find((item) => item.id === "f1").done, true);
assert.equal(actions.completeFollowUps(["f1"]), 0);
assert.equal(persisted, beforeBulkPersist + 1);

const before = state.followUps.length;
actions.addFollowUp({
  contactId: "c1",
  contactName: "甲",
  dueAt: "2026-08-22",
  note: "改期",
});
assert.equal(state.followUps.length, before + 1);
assert.equal(state.followUps.find((item) => item.id === "f1").dueAt, "2026-08-20");
assert.equal(state.followUps.find((item) => item.contactId === "c1" && !item.done).dueAt, "2026-08-22");
assert.equal(state.contacts.find((item) => item.id === "c1").nextFollowUpAt, "2026-08-22");

console.log("follow-up-actions.test.mjs ok");
