import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';

const source = readFileSync(new URL('../src/components/chat/ChatPanel.tsx', import.meta.url), 'utf8');
const start = source.indexOf('  useEffect(() => {', source.indexOf('/** 只跟随当前会话尾部'));
const effect = transformSync(source.slice(start, source.indexOf('  const mediaResyncAtRef', start)), { loader: 'ts' }).code;

function fixture() {
  const state = { selectedChatId: 'chat', messagesByChatId: { chat: [{ id: 'recent' }] } };
  const frames = new Map(), scrolls = [];
  let subscriber, cleanup, nextFrame = 0;
  const stick = { current: true };
  const context = vm.createContext({
    selectedChatId: 'chat', prevChatIdRef: { current: 'chat' }, stickToBottomRef: stick,
    useEffect: fn => { cleanup = fn(); },
    useAppStore: { getState: () => state, subscribe: fn => { subscriber = fn; return () => { subscriber = null; }; } },
    messageListRef: { current: { scrollToBottom: () => scrolls.push('bottom') } },
    requestAnimationFrame: fn => { frames.set(++nextFrame, fn); return nextFrame; },
    cancelAnimationFrame: id => frames.delete(id),
  });
  vm.runInContext(effect, context);
  return { state, stick, frames, scrolls, update(items) { state.messagesByChatId.chat = items; subscriber(state); },
    flush() { for (const [id, fn] of frames) { frames.delete(id); fn(); } }, close: () => cleanup() };
}

test('prepending history and updating reactions never request a jump to the latest message', () => {
  const ui = fixture();
  ui.update([{ id: 'old' }, { id: 'recent' }]);
  ui.update([{ id: 'old', reactions: ['heart'] }, { id: 'recent' }]);
  assert.equal(ui.frames.size, 0);
  ui.stick.current = false;
  ui.update([{ id: 'old' }, { id: 'recent' }, { id: 'live' }]);
  assert.equal(ui.frames.size, 0);
  ui.close();
});

test('a queued bottom jump is cancelled by reading history, switching chats, or unmounting', () => {
  const ui = fixture();
  ui.update([{ id: 'recent' }, { id: 'live' }]);
  assert.equal(ui.frames.size, 1);
  ui.stick.current = false; ui.flush();
  assert.equal(ui.scrolls.length, 0);
  ui.stick.current = true;
  ui.update([{ id: 'live' }, { id: 'next' }]);
  ui.state.selectedChatId = 'other'; ui.flush();
  assert.equal(ui.scrolls.length, 0);
  ui.state.selectedChatId = 'chat';
  ui.update([{ id: 'next' }, { id: 'latest' }]); ui.flush();
  assert.equal(ui.scrolls.length, 1);
  ui.update([{ id: 'latest' }, { id: 'last' }]); ui.close();
  assert.equal(ui.frames.size, 0);
});
