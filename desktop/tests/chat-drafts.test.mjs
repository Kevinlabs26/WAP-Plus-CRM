import assert from "node:assert/strict";
import test from "node:test";
import {
  getChatDraftValue,
  setChatDraftValue,
} from "../src/lib/chatDrafts.ts";

test("drafts stay isolated by chat and deleting one does not restore it", () => {
  let drafts = {};

  drafts = setChatDraftValue(drafts, "chat-a", "hello");
  drafts = setChatDraftValue(drafts, "chat-b", "bonjour");

  assert.equal(getChatDraftValue(drafts, "chat-a"), "hello");
  assert.equal(getChatDraftValue(drafts, "chat-b"), "bonjour");

  drafts = setChatDraftValue(drafts, "chat-a", "");

  assert.equal(getChatDraftValue(drafts, "chat-a"), "");
  assert.equal(getChatDraftValue(drafts, "chat-b"), "bonjour");
});
