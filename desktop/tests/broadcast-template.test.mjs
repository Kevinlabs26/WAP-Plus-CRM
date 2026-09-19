import assert from "node:assert/strict";
import {
  contactSendablePhone,
  estimateCampaignMinutes,
  parseBroadcastPhones,
  renderBroadcastTemplate,
  validateBroadcastTemplate,
} from "../src/lib/broadcastTemplate.ts";

assert.equal(
  renderBroadcastTemplate("你好 {name}，来自 {company}", {
    name: " Alice ",
    company: " Acme ",
  }),
  "你好 Alice，来自 Acme"
);
assert.equal(renderBroadcastTemplate("{name}", { name: "", company: "" }), "朋友");
assert.equal(
  renderBroadcastTemplate("您好 {name}", { name: "群成员", company: "" }),
  "您好 朋友"
);

assert.deepEqual(validateBroadcastTemplate("{name} {company}"), { ok: true });
assert.equal(validateBroadcastTemplate("{email}").ok, false);
assert.equal(validateBroadcastTemplate(" ").ok, false);
assert.equal(validateBroadcastTemplate("x".repeat(2001)).ok, false);

assert.equal(contactSendablePhone({ phone: "12025550123" }), "+12025550123");
assert.equal(contactSendablePhone({ phone: "123" }), null);
assert.deepEqual(
  parseBroadcastPhones("+12025550123, +12025550124\n+12025550123; bad"),
  ["+12025550123", "+12025550124"]
);
assert.deepEqual(parseBroadcastPhones("+12025550123,+12025550123"), [
  "+12025550123",
]);
assert.equal(estimateCampaignMinutes(10, 10, 10, 4), 2);
assert.equal(estimateCampaignMinutes(10, 20, 30, 4), 5);
assert.equal(estimateCampaignMinutes(0, 10), 0);

console.log("broadcast-template.test.mjs ok");
