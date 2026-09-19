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

console.log("message virtual index: ok");
