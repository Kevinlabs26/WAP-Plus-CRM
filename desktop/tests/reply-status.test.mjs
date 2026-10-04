import assert from 'node:assert/strict';
import test from 'node:test';
import { isAwaitingReply } from '../src/lib/replyStatus.ts';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const mocks = {
  '@/lib/storage': 'export const getMessageFromDb = async () => null; export const searchMessagesInDb = async () => null; export const clearStoredChatMessages = async () => {};',
  '@/lib/mediaCache': 'export const cacheMediaUrl = async () => {}; export const dropMediaCache = async () => {};',
  './persist': 'export const persist = () => {}; export const scheduleStatsRecompute = () => {};',
};
const built = await build({
  stdin: { contents: `export { createUiSlice } from './src/store/uiSlice.ts'; export { createMessageActionsSlice } from './src/store/messageActionsSlice.ts';`, resolveDir: fileURLToPath(new URL('../', import.meta.url)) },
  bundle: true, write: false, format: 'esm', platform: 'browser',
  plugins: [{ name: 'reply-disk-mocks', setup(b) {
    b.onResolve({ filter: /.*/ }, args => mocks[args.path] ? { path: args.path, namespace: 'mock' } : undefined);
    b.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path] }));
  } }], alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) },
});
const { createUiSlice, createMessageActionsSlice } = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));

test('actual store actions keep a read/queued/failed chat pending until successful delivery or manual handling', () => {
  let state = { chats: [{ id: 'chat', contactId: 'contact', lastMessageDirection: 'in', updatedAt: '2026-10-03T10:00:00Z', unread: 1 }],
    contacts: [], messages: [], selectedChatId: 'chat', selectedContactId: null, draftReplyByChatId: {}, unreadHoldUntilByChatId: {},
    settings: {}, recomputeStats() {}, logActivity() {} };
  const ctx = { get: () => state, set: patch => { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }; } };
  Object.assign(state, createUiSlice(ctx), createMessageActionsSlice(ctx));
  state.setSelectedChat('chat');
  assert.equal(state.chats[0].unread, 0);
  assert.equal(isAwaitingReply(state.chats[0]), true);
  const id = state.enqueueOutgoingMessage({ chatId: 'chat', body: 'reply', deliveryStatus: 'queued' });
  assert.equal(isAwaitingReply(state.chats[0]), true);
  state.updateMessageDelivery(id, { deliveryStatus: 'failed' });
  assert.equal(isAwaitingReply(state.chats[0]), true);
  state.updateMessageDelivery(id, { deliveryStatus: 'sent' });
  assert.equal(isAwaitingReply(state.chats[0]), false);
  state.chats[0].replyPendingSince = new Date(Date.now() - 1000).toISOString();
  state.markReplyHandled('chat');
  assert.equal(isAwaitingReply(state.chats[0]), false);
});

test('reading does not finish a task; handling finishes it and a newer customer message reopens it', () => {
  const chat = { lastMessageDirection: 'in', updatedAt: '2026-10-03T10:00:00Z', unread: 3 };
  assert.equal(isAwaitingReply(chat), true);
  assert.equal(isAwaitingReply({ ...chat, unread: 0 }), true);
  const handled = { ...chat, replyHandledAt: '2026-10-03T10:01:00Z' };
  assert.equal(isAwaitingReply(handled), false);
  assert.equal(isAwaitingReply({ ...handled, updatedAt: '2026-10-03T10:02:00Z' }), true);
  assert.equal(isAwaitingReply({ ...chat, archived: true }), false);
  assert.equal(isAwaitingReply({ ...chat, localOnly: true }), false);
  // A failed/pending outgoing preview must not clear the earlier inbound task.
  assert.equal(isAwaitingReply({ ...chat, lastMessageDirection: 'out', replyPendingSince: chat.updatedAt }), true);
  assert.equal(isAwaitingReply({ ...chat, replyPendingSince: '' }), false);
});
