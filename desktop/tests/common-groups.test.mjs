import assert from "node:assert/strict";
import test from "node:test";
import { commonGroupTargetMatches } from "../baileys-bridge/groupService.mjs";

test("common group matching supports phone and PN JID", () => {
  assert.equal(
    commonGroupTargetMatches(
      { phone: "+225 07010288215" },
      [{ id: "22507010288215@s.whatsapp.net" }]
    ),
    true
  );
});

test("common group matching supports a contact LID", () => {
  assert.equal(
    commonGroupTargetMatches(
      { jids: ["123456789012345@lid"] },
      [{ id: "123456789012345@lid", phoneNumber: "+22507010288215" }]
    ),
    true
  );
});

test("common group matching rejects unrelated members", () => {
  assert.equal(
    commonGroupTargetMatches(
      { phone: "+225 07010288215" },
      [{ id: "22507111111111@s.whatsapp.net" }]
    ),
    false
  );
});
