import assert from "node:assert/strict";
import { resolveSendTarget } from "../src/lib/utils.ts";

assert.equal(
  resolveSendTarget({ phone: "+12025550123" }),
  "+12025550123"
);
assert.equal(
  resolveSendTarget({ phone: "12025550123" }),
  "+12025550123"
);
assert.equal(
  resolveSendTarget({
    phone: "",
    channelAddress: "12025550123@s.whatsapp.net",
  }),
  "+12025550123"
);
assert.equal(
  resolveSendTarget({
    phone: "",
    channelAddress: "123456789012345@lid",
  }),
  "123456789012345@lid"
);
assert.equal(
  resolveSendTarget({
    phone: "+12025550123",
    channelAddress: "999@lid",
  }),
  "+12025550123"
);
assert.equal(resolveSendTarget({ phone: "", channelAddress: "" }), "");
assert.equal(resolveSendTarget({ phone: "not-a-phone" }), "");
assert.equal(
  resolveSendTarget({ channelAddress: "120363012345678@g.us" }),
  "120363012345678@g.us"
);

import { splitTextWithLinks } from "../src/lib/utils.ts";

const parts = splitTextWithLinks(
  "见 https://chat.whatsapp.com/abc 和 www.example.com/x 结束。"
);
assert.equal(parts.some((p) => p.type === "link"), true);
const hrefs = parts.filter((p) => p.type === "link").map((p) => p.href);
assert.ok(hrefs.includes("https://chat.whatsapp.com/abc"));
assert.ok(hrefs.includes("https://www.example.com/x"));

const phoneParts = splitTextWithLinks("号码 +2430815162031 打一下");
const phoneLink = phoneParts.find((p) => p.type === "link" && p.kind === "phone");
assert.ok(phoneLink);
assert.equal(phoneLink.value, "+2430815162031");
assert.equal(phoneLink.href, "tel:+2430815162031");

// 仅 LID、无手机号：应从 entityId 恢复
const lidOnly = resolveSendTarget({
  phone: "",
  channelAddress: "",
  entityId: "bridge-contact-" + encodeURIComponent("baileys:123456789012345@lid"),
});
assert.equal(lidOnly, "123456789012345@lid");

const lidChat = resolveSendTarget({
  phone: "",
  entityId:
    "bridge-chat-bridge-contact-" +
    encodeURIComponent("baileys:999888777666555@lid"),
});
assert.equal(lidChat, "999888777666555@lid");

console.log("resolve-send-target.test.mjs ok");
