import assert from 'node:assert/strict';
import test from 'node:test';
import { translateDraftText } from '../src/lib/translateDraft.ts';

const settings = { aiProvider: 'custom', customAiKey: 'test-only', customAiModel: 'test-model', customAiBaseUrl: 'https://example.invalid/v1', translateService: 'auto' };
const source = id => `Bonjour, je vous enverrai toutes les informations concernant votre commande demain matin. ${id}`;
const translated = '您好，明天早上我会给您发送有关订单的详细信息。';
const response = google => google ? Response.json([[[translated]]]) : Response.json({ choices: [{ message: { content: translated } }] });
const settle = () => new Promise(resolve => setImmediate(resolve));

function transport(t) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', (url, opts) => new Promise((resolve, reject) => {
    const google = String(url).includes('translate.googleapis.com');
    const call = { url: String(url), signal: opts.signal, finish: () => {
      opts.signal.removeEventListener('abort', abort); resolve(response(google));
    } };
    const abort = () => reject(opts.signal.reason);
    opts.signal.addEventListener('abort', abort, { once: true });
    calls.push(call);
    if (opts.signal.aborted) abort();
  }));
  return calls;
}

test('reading translations run two at a time; queued obsolete languages never reach the network and drafts do not wait', async t => {
  const calls = transport(t), controllers = Array.from({ length: 4 }, () => new AbortController());
  const requests = controllers.map((c, i) => translateDraftText(source(`queue-${i}`), 'zh', settings, { googleFirst: true, signal: c.signal }));
  assert.equal(calls.length, 2);
  const cancelled = assert.rejects(requests[2], { name: 'AbortError' });
  controllers[2].abort(); await cancelled;
  const draft = translateDraftText(source('foreground'), 'zh', settings);
  assert.equal(calls.length, 3, 'foreground translation bypasses the reading queue');
  calls[2].finish(); await draft;
  calls[0].finish(); await requests[0]; await settle();
  assert.equal(calls.length, 4); assert.ok(calls[3].url.includes('queue-3'));
  assert.ok(!calls.some(call => call.url.includes('queue-2')));
  calls[1].finish(); calls[3].finish(); await Promise.all([requests[1], requests[3]]);
});

test('cancelling one shared consumer keeps the other alive; cancelling the last aborts and remains retryable', async t => {
  const calls = transport(t), a = new AbortController(), b = new AbortController();
  const text = source('shared-cancel');
  const first = translateDraftText(text, 'zh', settings, { googleFirst: true, signal: a.signal });
  const second = translateDraftText(text, 'zh', settings, { googleFirst: true, signal: b.signal });
  assert.equal(calls.length, 1);
  const rejected = assert.rejects(first, { name: 'AbortError' }); a.abort(); await rejected;
  assert.equal(calls[0].signal.aborted, false);
  calls[0].finish(); assert.equal((await second).text, translated);
  const c = new AbortController(), nextText = source('last-consumer');
  const old = translateDraftText(nextText, 'zh', settings, { googleFirst: true, signal: c.signal });
  const oldRejected = assert.rejects(old, { name: 'AbortError' }); c.abort();
  assert.equal(calls[1].signal.aborted, true);
  const retry = translateDraftText(nextText, 'zh', settings, { googleFirst: true });
  await oldRejected; await settle();
  assert.equal(calls.length, 3, 'abort does not launch an AI fallback or reuse an aborted request');
  calls[2].finish(); assert.equal((await retry).fallback, false);
});

test('a foreground consumer sharing an explicit Google translation survives the reading card unmount', async t => {
  const calls = transport(t), controller = new AbortController();
  const text = source('shared-foreground'), googleSettings = { ...settings, translateService: 'google' };
  const card = translateDraftText(text, 'zh', googleSettings, { googleFirst: true, signal: controller.signal });
  const foreground = translateDraftText(text, 'zh', googleSettings);
  const rejected = assert.rejects(card, { name: 'AbortError' }); controller.abort(); await rejected;
  assert.equal(calls.length, 1); assert.equal(calls[0].signal.aborted, false);
  calls[0].finish(); assert.equal((await foreground).text, translated);
});

test('all translation transports propagate cancellation without a retry or cached late response', async t => {
  for (const aiProvider of ['custom', 'gemini', 'ollama']) {
    let signal, finish, calls = 0;
    t.mock.method(globalThis, 'fetch', async (_url, opts) => {
      calls++; signal = opts.signal;
      return new Promise(resolve => { finish = () => resolve(aiProvider === 'gemini'
        ? Response.json({ candidates: [{ content: { parts: [{ text: translated }] } }] })
        : aiProvider === 'ollama' ? Response.json({ message: { content: translated } }) : response(false)); });
    });
    const controller = new AbortController();
    const configured = { ...settings, aiProvider, translateService: 'ai', geminiKey: 'test-only', aiModel: 'test-model', ollamaUrl: 'http://localhost:11434' };
    const text = source(`provider-${aiProvider}`);
    const old = translateDraftText(text, 'zh', configured, { googleFirst: true, signal: controller.signal });
    const rejected = assert.rejects(old, { name: 'AbortError' }); controller.abort(); await rejected;
    assert.equal(signal.aborted, true); finish(); await settle(); assert.equal(calls, 1);
    const retry = translateDraftText(text, 'zh', configured); assert.equal(calls, 2, 'late output was not cached');
    finish(); assert.equal((await retry).text, translated);
    t.mock.restoreAll();
  }
});

test('already cancelled translations never read cached content or start transport', async t => {
  let calls = 0; t.mock.method(globalThis, 'fetch', async () => { calls++; return response(true); });
  await assert.rejects(translateDraftText(source('pre-cancelled'), 'zh', settings,
    { googleFirst: true, signal: AbortSignal.abort() }), { name: 'AbortError' });
  assert.equal(calls, 0);
});
