import assert from "node:assert/strict";
import { parseContactItem } from "../src/store/parseContactItem.ts";

// —— 手机号解析 ——
const withPhone = parseContactItem(
  { jid: "12025550123@s.whatsapp.net", phoneE164: "12025550123" },
  ""
);
assert.equal(withPhone?.phone, "+12025550123");
assert.equal(withPhone?.isGroup, false);

// 群：phone 为空
const group = parseContactItem(
  { jid: "120363012345678@g.us", subject: "销售群", participantCount: 12 },
  ""
);
assert.equal(group?.isGroup, true);
assert.equal(group?.phone, "");
assert.equal(group?.niceName, "销售群");
assert.equal(group?.participantCount, 12);

// —— channelAddress 提取（LID）——
const lid = parseContactItem({ jid: "123456789012345@lid", pushName: "张" }, "");
assert.equal(lid?.channelAddress, "123456789012345@lid");
const lidField = parseContactItem(
  { lid: "987654321098765@lid", displayName: "李" },
  ""
);
assert.equal(lidField?.channelAddress, "987654321098765@lid");

// —— 无可识别身份 → null ——
assert.equal(parseContactItem({}, ""), null);
assert.equal(parseContactItem({ phone: "" }, ""), null);

// —— 幽灵自己：名字=selfName 且无 phone → null ——
assert.equal(
  parseContactItem({ name: "我自己", jid: "55@s.whatsapp.net" }, "我自己"),
  null
);
// 有 phone 则不算幽灵
const withSelfNamePhone = parseContactItem(
  { name: "Self", phoneE164: "12025550123", jid: "12025550123@s.whatsapp.net" },
  "我自己"
);
assert.equal(withSelfNamePhone?.phone, "+12025550123");

// —— 内部名处理：纯数字名被清空 ——
const numericName = parseContactItem(
  { jid: "12025550123@s.whatsapp.net", name: "12025550123" },
  ""
);
assert.equal(numericName?.name, "");
assert.equal(numericName?.niceName, "+12025550123");

// displayName/name 是号码时，仍应继续使用后面的 WhatsApp 默认昵称
const pushNameFallback = parseContactItem(
  {
    jid: "2250710288215@s.whatsapp.net",
    displayName: "+225 0710288215",
    pushName: "~prophète Nathan",
  },
  ""
);
assert.equal(pushNameFallback?.name, "~prophète Nathan");
assert.equal(pushNameFallback?.niceName, "~prophète Nathan");

const memberPlaceholder = parseContactItem(
  { jid: "12025550124@s.whatsapp.net", name: "群成员" },
  ""
);
assert.equal(memberPlaceholder?.name, "");
assert.equal(memberPlaceholder?.niceName, "+12025550124");

// —— 群占位名 ——
const groupPlaceholder = parseContactItem(
  { jid: "120363012345678@g.us", subject: "群聊" },
  ""
);
assert.equal(groupPlaceholder?.name, "");
assert.equal(groupPlaceholder?.niceName, "群聊");

// —— 真实群名不误杀 ——
const realGroup = parseContactItem(
  { jid: "120363012345678@g.us", subject: "华东大客户 2026 群（沟通专用）" },
  ""
);
assert.equal(realGroup?.name, "华东大客户 2026 群（沟通专用）");

console.log("parseContactItem ok");
