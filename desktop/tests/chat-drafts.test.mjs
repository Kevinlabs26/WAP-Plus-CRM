import assert from "node:assert/strict";
import test from "node:test";
import {
  getChatDraftValue,
  setChatDraftValue,
  clearSentChatDraft,
  restoreChatDrafts,
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

test('startup restores only existing chat drafts without mixing accounts or invalid values', () => {
  const chats = [{ id: 'wa-a:peer' }, { id: 'wa-b:peer' }];
  const drafts = restoreChatDrafts({ 'wa-a:peer': '报价 A', 'wa-b:peer': 'Devis B', deleted: 'orphan', invalid: 42 }, chats);
  assert.deepEqual(drafts, { 'wa-a:peer': '报价 A', 'wa-b:peer': 'Devis B' });
  assert.deepEqual(restoreChatDrafts(undefined, chats), {});
  assert.deepEqual(restoreChatDrafts(['bad'], chats), {});
});

test('send completion preserves unflushed edits and clears only an unchanged originating draft', () => {
  const cleared = [];
  const state = { selectedChatId: 'A', draftReply: 'old', draftReplyByChatId: { A: 'old', B: 'keep' },
    setChatDraft: (...args) => cleared.push(args) };
  clearSentChatDraft(state, 'A', 'old', 'new text not yet in store');
  assert.deepEqual(cleared, []);
  state.selectedChatId = 'B'; state.draftReply = 'keep';
  clearSentChatDraft(state, 'A', 'old');
  assert.deepEqual(cleared, [['A', '']]);
});
