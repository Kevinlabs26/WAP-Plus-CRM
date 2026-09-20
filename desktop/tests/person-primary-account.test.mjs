import test from "node:test";
import assert from "node:assert/strict";
import {
  getPersonPrimaryAccount,
  setPersonPrimaryAccount,
} from "../src/lib/internalNotes.ts";

test("person primary account can be cleared after it is assigned", () => {
  const assigned = setPersonPrimaryAccount({}, "person-1", "account-a");
  assert.equal(getPersonPrimaryAccount(assigned, "person-1"), "account-a");

  const cleared = setPersonPrimaryAccount(assigned, "person-1", "");
  assert.equal(getPersonPrimaryAccount(cleared, "person-1"), "");
  assert.deepEqual(cleared, {});
});
