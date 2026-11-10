import assert from "node:assert/strict";
import {
  MESSAGE_VIRTUAL_INDEX_BASE,
  resolveMessageFirstItemIndex,
} from "../src/components/chat/messageVirtualIndex.ts";

const anchor = { chatId: null, messageId: null };
assert.equal(
  resolveMessageFirstItemIndex(anchor, "chat-a", [{ id: "m3" }, { id: "m4" }]),
  MESSAGE_VIRTUAL_INDEX_BASE
);
assert.equal(
  resolveMessageFirstItemIndex(anchor, "chat-a", [
    { id: "m1" },
    { id: "m2" },
    { id: "m3" },
    { id: "m4" },
  ]),
  MESSAGE_VIRTUAL_INDEX_BASE - 2
);
assert.equal(
  resolveMessageFirstItemIndex(anchor, "chat-a", [
    { id: "m1" },
    { id: "m2" },
    { id: "m3" },
    { id: "m4" },
    { id: "m5" },
  ]),
  MESSAGE_VIRTUAL_INDEX_BASE - 2
);
assert.equal(
  resolveMessageFirstItemIndex(anchor, "chat-b", [{ id: "other" }]),
  MESSAGE_VIRTUAL_INDEX_BASE
);

const history = Array.from({ length: 100 }, (_, i) => ({ id: `row-${i}` }));
const viewport = { chatId: "history", messageId: "row-40", virtualIndex: MESSAGE_VIRTUAL_INDEX_BASE + 40 };
assert.equal(resolveMessageFirstItemIndex(viewport, "history", history), MESSAGE_VIRTUAL_INDEX_BASE);
assert.equal(resolveMessageFirstItemIndex(viewport, "history", history.map(row => ({ ...row, reactions: [] }))), MESSAGE_VIRTUAL_INDEX_BASE);
const prepended = [...Array.from({ length: 80 }, (_, i) => ({ id: `old-${i}` })), ...history];
assert.equal(resolveMessageFirstItemIndex(viewport, "history", prepended), MESSAGE_VIRTUAL_INDEX_BASE - 80);
viewport.messageId = "row-10";
viewport.virtualIndex = MESSAGE_VIRTUAL_INDEX_BASE + 10;
assert.equal(resolveMessageFirstItemIndex(viewport, "history", prepended), MESSAGE_VIRTUAL_INDEX_BASE - 80);
assert.equal(resolveMessageFirstItemIndex(viewport, "history", [...prepended, { id: "live" }]), MESSAGE_VIRTUAL_INDEX_BASE - 80);
assert.equal(resolveMessageFirstItemIndex(viewport, "history", prepended.slice(20)), MESSAGE_VIRTUAL_INDEX_BASE - 60);

console.log("message virtual index: ok");
