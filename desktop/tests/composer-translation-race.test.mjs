import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

// Execute the actual async UI handler with controlled service completion;
// no live account, network request or copy of its implementation is needed.
const source = readFileSync(new URL('../src/components/chat/Composer.tsx', import.meta.url), 'utf8');
const start = source.indexOf('  const handleTranslateDraft = async () => {');
const end = source.indexOf('  const restoreTranslateOriginal =', start);
assert.ok(start >= 0 && end > start);
const create = new Function('translateDraftText', `
  let draft = 'same draft', translating = false, translateOriginal = null;
  const translationRequestRef = { current: 0 };
  const writes = [], toasts = [];
  const recording = false, translateLang = 'fr';
  const readDraft = () => draft;
  const fullSettings = () => ({});
  const setTranslating = value => { translating = value; };
  const setTranslateOriginal = value => { translateOriginal = value; };
  const setDraftLocal = value => { draft = value; writes.push(value); };
  const flushDraftNow = value => writes.push(value);
  const pushToast = (...args) => toasts.push(args);
  const t = key => key, langShortLabel = code => code;
  ${source.slice(start, end)}
  return { run: handleTranslateDraft, writes, toasts,
    edit(value) { draft = value; translateOriginal = null; },
    switchChat() { translationRequestRef.current++; translating = false; translateOriginal = null; },
    state: () => ({ draft, translating, translateOriginal }) };
`);

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('late translation cannot replace an identical draft in another chat or clear a newer request', async () => {
  const first = deferred(), second = deferred();
  let calls = 0;
  const ui = create(() => (++calls === 1 ? first.promise : second.promise));
  const oldRun = ui.run();
  ui.switchChat();
  const newRun = ui.run();
  first.resolve({ text: 'wrong customer translation', targetLang: 'fr' });
  await oldRun;
  assert.deepEqual(ui.writes, []);
  assert.deepEqual(ui.toasts, []);
  assert.equal(ui.state().translating, true);
  assert.equal(ui.state().translateOriginal, null);
  second.resolve({ text: 'correct translation', targetLang: 'fr' });
  await newRun;
  assert.equal(ui.state().draft, 'correct translation');
  assert.equal(ui.state().translateOriginal, 'same draft');
  assert.equal(ui.state().translating, false);
});

test('stale translation failure is silent; edits and failed service keep the draft and undo state', async () => {
  const pending = deferred();
  const stale = create(() => pending.promise);
  const run = stale.run();
  stale.switchChat();
  pending.reject(new Error('old chat error'));
  await run;
  assert.deepEqual(stale.toasts, []);
  const edited = create(async () => { edited.edit('new customer draft'); return { text: 'old result' }; });
  await edited.run();
  assert.equal(edited.state().draft, 'new customer draft');
  assert.equal(edited.state().translateOriginal, null);
  const failed = create(async () => ({ text: '', error: 'offline' }));
  await failed.run();
  assert.equal(failed.state().draft, 'same draft');
  assert.equal(failed.state().translateOriginal, null);
  assert.equal(failed.state().translating, false);
});
