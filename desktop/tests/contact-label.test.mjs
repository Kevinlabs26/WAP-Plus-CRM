import assert from "node:assert/strict";
import { displayContactLabel } from "../src/lib/utils.ts";

// 仅有 LID、无号码/真名 → 未备注（不把内部 id 当标题）
assert.equal(
  displayContactLabel("", "", "123456789012345@lid"),
  "未备注联系人"
);
assert.equal(displayContactLabel("", "+12025550123", "123@lid"), "+12025550123");
assert.equal(displayContactLabel("Alice", "", "123@lid"), "Alice");
// 名字是占位/内部 id 时回落到号码
assert.equal(
  displayContactLabel("未知联系人", "+12025550124", ""),
  "+12025550124"
);
assert.equal(
  displayContactLabel("群成员", "+12025550124", ""),
  "+12025550124"
);

console.log("contact-label.test.mjs ok");
