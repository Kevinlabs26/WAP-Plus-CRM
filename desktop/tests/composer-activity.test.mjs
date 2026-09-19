import assert from "node:assert/strict";
import {
  isComposerInputActive,
  isComposerInputFocused,
  isComposerTypingBusy,
  markComposerInput,
} from "../src/lib/composerActivity.ts";

markComposerInput(1_000);
assert.equal(isComposerInputActive(2_199), true);
assert.equal(isComposerInputActive(2_200), false);
assert.equal(isComposerInputActive(1_499, 500), true);
assert.equal(isComposerInputActive(1_500, 500), false);
assert.equal(isComposerInputFocused(), false);

// 未聚焦时 isComposerTypingBusy 恒为 false（无 document / 未聚焦）
assert.equal(isComposerTypingBusy(1_001), false);

// 模拟输入框聚焦：document.activeElement 命中 data-composer-input
const originalDocument = globalThis.document;
try {
  globalThis.document = {
    hidden: false,
    activeElement: { getAttribute: () => "true" },
  };
  assert.equal(isComposerInputFocused(), true);
  markComposerInput(5_000);
  // 聚焦且 4s 窗口内有输入 → 视为正在打字，后台同步应让路
  assert.equal(isComposerTypingBusy(8_999), true);
  assert.equal(isComposerTypingBusy(9_000), false);
  // 隐藏页面时放行（不在打字）
  globalThis.document.hidden = true;
  assert.equal(isComposerTypingBusy(5_500), false);
} finally {
  globalThis.document = originalDocument;
}

console.log("composer activity: ok");
