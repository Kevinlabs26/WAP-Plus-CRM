import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { generateSuggestions, getSuggestionContextKey } from '../src/lib/aiSuggest.ts';
globalThis.replyContextKey = getSuggestionContextKey;

const contact = { id: 'customer', accountId: 'a', name: 'Customer', tags: [] };
const target = { id: 'target', chatId: 'chat', accountId: 'a', direction: 'in', body: 'SELECTED QUESTION', sentAt: '2026-01-01T00:00:00Z' };
const settings = { aiProvider: 'custom', customAiBaseUrl: 'https://example.invalid/v1', customAiKey: 'test', customAiModel: 'model', aiModel: '',
  geminiKey: 'test', ollamaUrl: 'http://localhost:11434', aiSystemPrompt: 'GLOBAL ROLE', aiSystemPromptByAccountId: { a: 'ACCOUNT A ROLE', b: 'ACCOUNT B ROLE' } };

test('selected-message replies request one draft across all provider paths, with the explicit target and correct account role', async t => {
  for (const provider of ['custom', 'gemini', 'ollama']) {
    let body;
    const output = JSON.stringify([{ text: 'A targeted reply' }, { text: 'Unneeded second option' }]);
    const mock = t.mock.method(globalThis, 'fetch', async (_url, opts) => {
      body = JSON.parse(opts.body);
      return Response.json(provider === 'gemini' ? { candidates: [{ content: { parts: [{ text: output }] } }] }
        : provider === 'ollama' ? { message: { content: output } } : { choices: [{ message: { content: output } }] });
    });
    const history = Array.from({ length: 80 }, (_, i) => ({ ...target, id: `new-${i}`, body: `NEWER MESSAGE ${i}`, sentAt: `2026-01-02T00:${String(i % 60).padStart(2, '0')}:00Z` }));
    const result = await generateSuggestions(contact, history, { ...settings, aiProvider: provider }, { accountId: 'a', replyTo: target });
    const system = provider === 'gemini' ? body.systemInstruction.parts[0].text : body.messages[0].content;
    const user = provider === 'gemini' ? body.contents[0].parts[0].text : body.messages[1].content;
    assert.equal(result.fallback, false);
    assert.deepEqual(result.suggestions.map(s => s.text), ['A targeted reply']);
    assert.match(system, /exactly 1 object/);
    assert.match(system, /ACCOUNT A ROLE/);
    assert.doesNotMatch(system, /ACCOUNT B ROLE|GLOBAL ROLE|replying DIRECTLY/);
    assert.match(user, /SELECTED QUESTION/);
    assert.match(user, /NEWER MESSAGE/);
    assert.match(user, /specifically to this selected message/);
    assert.equal(provider === 'gemini' ? body.generationConfig.maxOutputTokens : provider === 'ollama' ? body.options.num_predict : body.max_tokens, 160);
    mock.mock.restore();
  }
});

const mocks = {
  react: `export const useRef = v => globalThis.replyHooks.ref(v); export const useState = v => globalThis.replyHooks.state(v); export const useEffect = (fn,deps) => globalThis.replyHooks.effect(fn,deps);`,
  '@/store/appStore': 'export const useAppStore = {getState: () => globalThis.replyState};',
  '@/lib/aiSuggest': 'export const hasRealAiKey = s => s.ready; export const getSuggestionContextKey = (...args) => globalThis.replyContextKey(...args); export const generateSuggestions = (...args) => globalThis.replyGenerate(...args);',
  '@/i18n': 'export const translateCurrent = k => k;',
};
const built = await build({
  entryPoints: [fileURLToPath(new URL('../src/components/chat/useAiMessageReply.ts', import.meta.url))],
  bundle: true, write: false, format: 'esm', platform: 'browser', alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) },
  plugins: [{ name: 'reply-boundaries', setup(b) {
    b.onResolve({ filter: /.*/ }, args => mocks[args.path] ? { path: args.path, namespace: 'mock' } : undefined);
    b.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path] }));
  } }],
});
const { useAiMessageReply } = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
function fixture() {
  const cells = [], effects = [], writes = [], toasts = [], calls = []; let cursor = 0, draft = '';
  globalThis.replyHooks = {
    ref(v) { return cells[cursor++] ??= { current: v }; },
    state(v) { const i = cursor++; cells[i] ??= { value: typeof v === 'function' ? v() : v }; return [cells[i].value, x => { cells[i].value = x; }]; },
    effect(fn, deps) { const i = cursor++, old = cells[i]; if (old && deps.every((x,j) => Object.is(x,old.deps[j]))) return;
      cells[i] = { deps, cleanup: old?.cleanup }; effects.push(() => { cells[i].cleanup?.(); cells[i].cleanup = fn(); }); },
  };
  const state = globalThis.replyState = { selectedChatId: 'chat', selectedContactId: 'customer', selectedThreadAccount: { accountId: 'a' }, settings: { ready: true }, pushToast: (...a) => toasts.push(a) };
  globalThis.replyGenerate = (...args) => new Promise((resolve,reject) => calls.push({ args, resolve, reject }));
  const opts = { chatId: 'chat', contact, accountId: 'a', messages: [target], getDraft: () => draft, editingId: null, replyTo: null,
    setDraftReply: text => { draft = text; writes.push(['draft',text]); }, setReplyTo: quote => writes.push(['quote',quote]) };
  return { state, opts, writes, calls, toasts, get draft() { return draft; }, set draft(v) { draft = v; },
    render() { cursor = 0; const hook = useAiMessageReply(opts); effects.splice(0).forEach(fn => fn()); return hook; },
    unmount() { cells.forEach(c => c?.cleanup?.()); } };
}
const success = { fallback: false, suggestions: [{ text: 'Ready to review' }] };

test('right-click reply fills the draft and quotes only the selected message; repeated clicks share one call', async () => {
  const f = fixture(), ui = f.render();
  const run = ui.aiReply(target); await ui.aiReply(target);
  assert.equal(f.calls.length, 1);
  assert.equal(f.render().aiReplyingId, target.id);
  assert.equal(f.calls[0].args[3].accountId, 'a');
  assert.equal(f.calls[0].args[3].replyTo, target);
  f.calls[0].resolve(success); assert.equal(await run, true);
  assert.equal(f.draft, 'Ready to review');
  assert.deepEqual(f.writes, [['quote', { id: target.id, direction: 'in', body: target.body }], ['draft', 'Ready to review']]);
  assert.equal(f.render().aiReplyingId, null);
  f.unmount();
});

test('existing drafts, edits, untranscribed audio and unconfigured AI do not spend a request', async () => {
  for (const mode of ['draft','editing','audio','unconfigured','outgoing','wrong-chat']) {
    const f = fixture(); let message = target;
    if (mode === 'draft') f.draft = 'unsaved DOM draft';
    if (mode === 'editing') f.opts.editingId = 'edit';
    if (mode === 'unconfigured') f.state.settings.ready = false;
    if (mode === 'audio') message = { ...target, mediaType: 'audio', body: '[audio]' };
    if (mode === 'outgoing') message = { ...target, direction: 'out' };
    if (mode === 'wrong-chat') message = { ...target, id: 'other', chatId: 'other' };
    assert.equal(await f.render().aiReply(message), false);
    assert.equal(f.calls.length, 0, mode);
    assert.deepEqual(f.writes, [], mode); f.unmount();
  }
});

test('literal bracket text and transcribed voice can both be replied to', async () => {
  for (const patch of [{ body: '[yes]' }, { mediaType: 'audio', body: '[audio]', transcript: 'Are you coming?' }]) {
    const f = fixture(), message = { ...target, ...patch };
    f.opts.messages = [message];
    const run = f.render().aiReply(message);
    assert.equal(f.calls.length, 1);
    f.calls[0].resolve(success); assert.equal(await run, true);
    assert.equal(f.writes[0][1].body, patch.transcript || patch.body); f.unmount();
  }
});

test('late AI replies preserve new typing, edits and quote choices and never cross chat/account switches or unmount', async () => {
  for (const change of ['typing','editing','quote','chat','account','contact','unmount']) {
    const f = fixture(), run = f.render().aiReply(target);
    if (change === 'typing') f.draft = 'just typed, not flushed';
    if (change === 'editing') { f.opts.editingId = 'edit'; f.render(); }
    if (change === 'quote') { f.opts.replyTo = { id: 'new-quote' }; f.render(); }
    if (change === 'chat') f.state.selectedChatId = 'other';
    if (change === 'account') f.state.selectedThreadAccount = { accountId: 'b' };
    if (change === 'contact') f.state.selectedContactId = 'other';
    if (change === 'unmount') f.unmount();
    f.calls[0].resolve(success); assert.equal(await run, false, change);
    assert.deepEqual(f.writes, [], change); f.unmount();
  }
});

test('service failure and fallback never fill fabricated replies and release the request lock for retry', async () => {
  for (const reject of [false,true]) {
    const f = fixture(), run = f.render().aiReply(target);
    if (reject) f.calls[0].reject(new Error('service error'));
    else f.calls[0].resolve({ ...success, fallback: true, error: 'failed' });
    assert.equal(await run, false); assert.deepEqual(f.writes, []);
    const retry = f.render().aiReply(target); assert.equal(f.calls.length, 2);
    f.calls[1].resolve(success); assert.equal(await retry, true); f.unmount();
  }
});

test('switching accounts invalidates the old request without clearing a new request or its loading state', async () => {
  const f = fixture(), old = f.render().aiReply(target);
  f.opts.accountId = 'b'; f.state.selectedThreadAccount = { accountId: 'b' };
  const next = f.render().aiReply(target);
  assert.equal(f.calls.length, 2);
  f.calls[0].resolve(success); assert.equal(await old, false);
  assert.equal(f.render().aiReplyingId, target.id);
  assert.deepEqual(f.writes, []);
  f.calls[1].resolve(success); assert.equal(await next, true);
  assert.equal(f.calls[1].args[3].accountId, 'b');
  assert.equal(f.render().aiReplyingId, null); f.unmount();
});

test('a reply held back by new typing is retained and reused once the draft is cleared', async () => {
  const f = fixture(), run = f.render().aiReply(target);
  f.draft = 'Keep my typing'; f.calls[0].resolve(success);
  assert.equal(await run, false); assert.equal(f.draft, 'Keep my typing');
  f.draft = ''; const retry = f.render().aiReply(target);
  assert.equal(f.calls.length, 1, 'use the completed reply, do not pay for another call');
  assert.equal(await retry, true); assert.equal(f.draft, 'Ready to review'); f.unmount();
});

test('identity, model, selected message and recent context changes never reuse or apply an obsolete reply', async () => {
  for (const kind of ['identity','model','message','context','stage']) {
    const f = fixture(), run = f.render().aiReply(target);
    if (kind === 'identity') f.state.settings = { ...f.state.settings, aiSystemPrompt: 'New identity' };
    if (kind === 'model') f.state.settings = { ...f.state.settings, customAiModel: 'different' };
    if (kind === 'message') f.opts.messages = [{ ...target, body: 'edited question' }];
    if (kind === 'context') f.opts.messages = [target, { ...target, id: 'new', body: 'new fact', sentAt: '2026-01-01T00:01:00Z' }];
    if (kind === 'stage') f.opts.contact = { ...contact, stage: 'won' };
    f.render(); f.calls[0].resolve(success); assert.equal(await run, false, kind);
    assert.deepEqual(f.writes, [], kind);
    const retry = f.render().aiReply(f.opts.messages[0]); assert.equal(f.calls.length, 2, kind);
    f.calls[1].resolve(success); assert.equal(await retry, true, kind); f.unmount();
  }
});
