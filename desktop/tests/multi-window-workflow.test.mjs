import test from 'node:test';
import assert from 'node:assert/strict';
import { retainOpenWindows, replaceWindowSlot, undoWindowSlot, windowWorkStatus } from '../src/features/multiWindow/lib/workflow.ts';

test('live queue changes never remove or reorder an available open conversation', () => {
  const open = ['a', 'b', 'c'];
  assert.deepEqual(retainOpenWindows(open, new Set(['a', 'b', 'c', 'new'])), open);
  assert.deepEqual(retainOpenWindows(open, new Set(['a', 'c', 'new'])), ['a', 'c']);
});

test('an explicit completion replaces one slot and undo restores its exact position', () => {
  const open = ['a', 'b', 'c'];
  const next = replaceWindowSlot(open, 'b', 'next');
  assert.deepEqual(next, ['a', 'next', 'c']);
  assert.deepEqual(undoWindowSlot(next, 'b', 'next', 1, -1), open);
  assert.deepEqual(undoWindowSlot([...next, 'new'], 'b', 'next', 1, -1), [...open, 'new']);
  assert.deepEqual(replaceWindowSlot(open, 'b', 'b'), open);
});

test('taking a customer from another page swaps slots without shifting any other cards', () => {
  const open = Array.from({ length: 20 }, (_, i) => `chat-${i}`);
  const swapped = replaceWindowSlot(open, 'chat-12', 'chat-1');
  assert.equal(swapped[12], 'chat-1');
  assert.equal(swapped[1], 'chat-12');
  assert.equal(swapped.length, open.length);
  for (const i of [0, 2, 11, 13, 19]) assert.equal(swapped[i], open[i]);
  assert.deepEqual(undoWindowSlot(swapped, 'chat-12', 'chat-1', 12, 1), open);
});

test('sending, manual completion, and the next inbound have separate work states', () => {
  const chat = { id: 'a', lastMessageDirection: 'in', updatedAt: '2026-10-29T12:00:00Z', replyPendingSince: '2026-10-29T12:00:00Z' };
  assert.equal(windowWorkStatus(chat), 'pending');
  const replied = { ...chat, lastMessageDirection: 'out', replyPendingSince: '', updatedAt: '2026-10-29T12:01:00Z' };
  assert.equal(windowWorkStatus(replied), 'waiting');
  const done = { ...replied, replyHandledAt: '2026-10-29T12:02:00Z' };
  assert.equal(windowWorkStatus(done), 'done');
  assert.equal(windowWorkStatus({ ...done, lastMessageDirection: 'in', replyPendingSince: '2026-10-29T12:03:00Z', updatedAt: '2026-10-29T12:03:00Z' }), 'pending');
});
