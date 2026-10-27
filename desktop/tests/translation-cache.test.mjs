import assert from 'node:assert/strict';
import test from 'node:test';
import { translateDraftText } from '../src/lib/translateDraft.ts';

const settings = { aiProvider: 'custom', aiModel: '', customAiModel: 'one', customAiBaseUrl: 'https://example.invalid/v1', customAiKey: 'fake', translateService: 'ai' };
const translated = 'Hello, I will send you all the information about your order tomorrow morning.';
const source = id => `Bonjour, je vous enverrai les informations concernant votre commande demain matin. ${id}`;

test('translations invalidate on model, endpoint or service changes and cached source labels stay accurate', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    calls.push(url);
    return String(url).includes('translate.googleapis.com') ? Response.json([[[translated]]])
      : Response.json({ choices: [{ message: { content: translated } }] });
  });
  const text = source('configuration');
  const first = await translateDraftText(text, 'en', settings);
  assert.equal(first.source, 'custom');
  await translateDraftText(text, 'en', { ...settings, customAiKey: 'rotated' });
  assert.equal(calls.length, 1, 'credentials do not enter cache keys');
  await translateDraftText(text, 'en', { ...settings, customAiModel: 'two' });
  assert.equal(calls.length, 2);
  await translateDraftText(text, 'en', { ...settings, customAiBaseUrl: 'https://other.invalid/v1' });
  assert.equal(calls.length, 3);
  const google = await translateDraftText(text, 'en', { ...settings, translateService: 'google' });
  assert.equal(calls.length, 4); assert.equal(google.source, 'google');
  const cachedGoogle = await translateDraftText(text, 'en', { ...settings, translateService: 'google' });
  assert.equal(calls.length, 4); assert.equal(cachedGoogle.source, 'google');
  const unconfigured = await translateDraftText(text, 'en', { ...settings, customAiKey: '' });
  assert.equal(unconfigured.fallback, true, 'old cache cannot hide a missing AI configuration');
});

test('identical simultaneous translations share one request without shortening the source or prompts', async t => {
  let finish; const pending = new Promise(resolve => { finish = resolve; }); let calls = 0, body;
  t.mock.method(globalThis, 'fetch', async (_url, opts) => { calls++; body = JSON.parse(opts.body); await pending;
    return Response.json({ choices: [{ message: { content: translated } }] }); });
  const text = source('simultaneous') + ' DETAILS '.repeat(3000);
  const a = translateDraftText(text, 'en', settings), b = translateDraftText(text, 'en', settings);
  assert.equal(calls, 1);
  assert.ok(body.messages[1].content.includes(text.trim()));
  assert.match(body.messages[0].content, /Keep numbers, model names, URLs, @mentions and WhatsApp formatting/);
  finish(); assert.deepEqual(await a, await b);
});

test('failed translations remain retryable, expired entries refresh, and old entries are bounded', async t => {
  let calls = 0, fail = true;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return fail ? new Response('', { status: 503 })
    : Response.json({ choices: [{ message: { content: translated } }] }); });
  const text = source('retry');
  assert.equal((await translateDraftText(text, 'en', settings)).fallback, true);
  fail = false; assert.equal((await translateDraftText(text, 'en', settings)).fallback, false);
  assert.equal(calls, 2);
  const now = Date.now(); const clock = t.mock.method(Date, 'now', () => now + 11 * 60_000);
  await translateDraftText(text, 'en', settings); assert.equal(calls, 3); clock.mock.restore();
  for (let i = 0; i < 130; i++) await translateDraftText(source(`bounded-${i}`), 'en', settings);
  const before = calls; await translateDraftText(text, 'en', settings);
  assert.equal(calls, before + 1, 'evict old entries instead of retaining every translation');
});
