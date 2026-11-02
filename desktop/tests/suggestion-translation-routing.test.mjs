import assert from 'node:assert/strict';
import test from 'node:test';
import { getTranslationContextKey, translateDraftText } from '../src/lib/translateDraft.ts';

const settings = { aiProvider: 'custom', customAiKey: 'test-only', customAiModel: 'test-model', customAiBaseUrl: 'https://example.invalid/v1', translateService: 'auto' };
const reading = { googleFirst: true };
const input = id => `Bonjour, je vous enverrai les informations concernant votre commande demain matin. ${id}`;
const translated = '您好，明天早上我会给您发送有关订单的详细信息。';
const isGoogle = url => String(url).startsWith('https://translate.googleapis.com/');
const aiResponse = () => Response.json({ choices: [{ message: { content: translated } }] });

test('reading auto tries Google first, shares in-flight work, and caches the actual source separately from ordinary translation', async t => {
  const calls = []; let finish;
  const wait = new Promise(resolve => { finish = resolve; });
  t.mock.method(globalThis, 'fetch', async url => {
    calls.push(isGoogle(url) ? 'google' : 'ai');
    if (isGoogle(url)) { await wait; return Response.json([[[translated]]]); }
    return aiResponse();
  });
  const text = input('reading-first');
  const first = translateDraftText(text, 'zh', settings, reading);
  const second = translateDraftText(text, 'zh', settings, reading);
  assert.deepEqual(calls, ['google']);
  finish();
  const result = await first;
  assert.deepEqual(await second, result);
  assert.equal(result.source, 'google'); assert.equal(result.fallback, false);
  assert.deepEqual(await translateDraftText(text, 'zh', settings, reading), result);
  assert.deepEqual(calls, ['google']);
  assert.equal((await translateDraftText(text, 'zh', settings)).source, 'custom');
  assert.deepEqual(calls, ['google', 'ai'], 'ordinary messages/drafts retain AI-first auto behavior');
});

test('Google HTTP/network/invalid/wrong-language failures use configured AI once and cache its result', async t => {
  const failures = [() => new Response('', { status: 429 }), () => { throw Error('offline'); }, () => Response.json({}), () => Response.json([[['Bonjour, je vous donnerai tous les détails demain matin.']]])];
  for (let i = 0; i < failures.length; i++) {
    const calls = [];
    t.mock.method(globalThis, 'fetch', async url => {
      calls.push(isGoogle(url) ? 'google' : 'ai');
      return isGoogle(url) ? failures[i]() : aiResponse();
    });
    const text = input(`google-failure-${i}`);
    const result = await translateDraftText(text, 'zh', settings, reading);
    assert.equal(result.fallback, false); assert.equal(result.source, 'custom');
    assert.equal(result.text, translated);
    assert.deepEqual(calls, ['google', 'ai']);
    assert.deepEqual(await translateDraftText(text, 'zh', settings, reading), result);
    assert.deepEqual(calls, ['google', 'ai']);
    t.mock.restoreAll();
  }
});

test('reading Google times out after three seconds and falls through to AI', async t => {
  const deadlines = [];
  const originalTimeout = AbortSignal.timeout;
  t.mock.method(AbortSignal, 'timeout', ms => {
    deadlines.push(ms);
    return ms === 3_000 ? AbortSignal.abort(new DOMException('Timed out', 'TimeoutError')) : originalTimeout(ms);
  });
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    calls.push(isGoogle(url) ? 'google' : 'ai');
    if (isGoogle(url)) { assert.equal(opts.signal.aborted, true); throw opts.signal.reason; }
    return aiResponse();
  });
  const result = await translateDraftText(input('timeout'), 'zh', settings, reading);
  assert.equal(result.source, 'custom'); assert.equal(result.fallback, false);
  assert.deepEqual(calls, ['google', 'ai']); assert.deepEqual(deadlines, [3_000, 60_000]);
});

test('explicit AI and Google choices remain authoritative even on failure', async t => {
  for (const service of ['ai', 'google']) {
    for (const fail of [false, true]) {
      const calls = [];
      t.mock.method(globalThis, 'fetch', async url => {
        calls.push(isGoogle(url) ? 'google' : 'ai');
        if (fail) throw Error('offline');
        return isGoogle(url) ? Response.json([[[translated]]]) : aiResponse();
      });
      const result = await translateDraftText(input(`explicit-${service}-${fail}`), 'zh', { ...settings, translateService: service }, reading);
      assert.equal(result.fallback, fail);
      assert.deepEqual(calls, [service]);
      t.mock.restoreAll();
    }
  }
});

test('both failures or missing AI preserve the original and remain retryable without a Google retry loop', async t => {
  const calls = []; let recover = false;
  t.mock.method(globalThis, 'fetch', async url => {
    calls.push(isGoogle(url) ? 'google' : 'ai');
    if (isGoogle(url)) throw Error('offline');
    return Response.json({ choices: [{ message: { content: recover ? translated : 'Bonjour, je vous donnerai tous les détails demain matin.' } }] });
  });
  const text = input('both-fail');
  const failure = await translateDraftText(text, 'zh', settings, reading);
  assert.equal(failure.fallback, true); assert.equal(failure.text, '');
  assert.deepEqual(calls, ['google', 'ai', 'ai'], 'wrong language retries AI, never Google again');
  recover = true;
  assert.equal((await translateDraftText(text, 'zh', settings, reading)).fallback, false);
  assert.deepEqual(calls.slice(3), ['google', 'ai']);
  calls.length = 0;
  const noKey = await translateDraftText(input('missing-key'), 'zh', { ...settings, customAiKey: '' }, reading);
  assert.equal(noKey.fallback, true); assert.equal(noKey.text, '');
  assert.deepEqual(calls, ['google']);
});

test('reading cache policy distinguishes automatic routing but does not expose credentials or alter explicit choices', () => {
  const text = input('keys');
  assert.notEqual(getTranslationContextKey(text, 'zh', settings, reading), getTranslationContextKey(text, 'zh', settings));
  assert.equal(getTranslationContextKey(text, 'zh', settings, reading), getTranslationContextKey(text, 'zh', { ...settings, customAiKey: 'rotated' }, reading));
  assert.ok(!getTranslationContextKey(text, 'zh', settings, reading).includes('test-only'));
  for (const translateService of ['ai', 'google']) {
    const explicit = { ...settings, translateService };
    assert.equal(getTranslationContextKey(text, 'zh', explicit, reading), getTranslationContextKey(text, 'zh', explicit));
  }
});
