import assert from "node:assert/strict";
import {
  buildContactVcard,
  parseContactVcard,
} from "../baileys-bridge/contactVcard.mjs";
import { describeMessage } from "../baileys-bridge/messageDescribe.mjs";

const built = buildContactVcard("Sample Contact", "+1 (202) 555-0147");
assert.equal(built?.phoneE164, "+12025550147");
assert.match(built?.vcard || "", /waid=12025550147:\+12025550147/);
assert.deepEqual(parseContactVcard(built?.vcard), {
  displayName: "Sample Contact",
  phoneE164: "+12025550147",
});
assert.equal(buildContactVcard("Bad", "123"), null);

const described = describeMessage({
  message: {
    contactMessage: {
      displayName: "Shared Person",
      vcard: built?.vcard,
    },
  },
});
assert.equal(described.mediaType, "contact");
assert.equal(described.contactCard?.displayName, "Shared Person");
assert.equal(described.contactCard?.phoneE164, "+12025550147");

console.log("contact card ok");
