import assert from 'node:assert/strict';
import test from 'node:test';
import { generateSuggestions } from '../src/lib/aiSuggest.ts';
import { geminiGenerate } from '../src/lib/gemini.ts';

const settings = { aiProvider: 'gemini', geminiKey: 'test-only', aiModel: 'configured-model', aiSystemPrompt: 'Reply naturally.' };
const event = text => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })}\r\n\r\n`;
const settle = () => new Promise(resolve => setImmediate(resolve));

test('Gemini publishes a complete first suggestion before the remaining stream finishes', async t => {
  let controller, requestedUrl, body;
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    requestedUrl = url; body = JSON.parse(opts.body);
    return new Response(new ReadableStream({ start(c) { controller = c; } }));
  });
  const updates = [];
  let finished = false;
  const pending = generateSuggestions({ id: 'a', name: 'A', tags: [] }, [], settings,
    { onProgress: result => updates.push(result) }).then(result => { finished = true; return result; });
  await settle();
  assert.match(requestedUrl, /configured-model:streamGenerateContent\?alt=sse$/);
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  const text = '你好，引用 "{这不是对象}"。';
  const first = event('[' + JSON.stringify({ text }) + ',');
  const bytes = new TextEncoder().encode(first);
  // Exercise SSE delimiters and multi-byte UTF-8 split across arbitrary network reads.
  for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
  await settle();
  assert.equal(finished, false);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].suggestions[0].text, text);
  controller.enqueue(new TextEncoder().encode(event('{"text":"第二条尚未完成')));
  await settle();
  assert.equal(updates.length, 1);
  controller.enqueue(new TextEncoder().encode(event('"},{"text":"第三条"}]')));
  controller.close();
  const result = await pending;
  assert.equal(result.fallback, false);
  assert.equal(result.suggestions.length, 3);
  assert.equal(updates.at(-1).suggestions.length, 3);
});

test('ordinary Gemini callers retain the non-streaming API', async t => {
  t.mock.method(globalThis, 'fetch', async url => {
    assert.match(url, /:generateContent$/);
    return Response.json({ candidates: [{ content: { parts: [{ text: 'OK' }] } }] });
  });
  assert.equal(await geminiGenerate({ apiKey: 'test', user: 'Hello' }), 'OK');
});

test('stream failure, blocked content and excessive output fail closed and cancel the reader', async t => {
  for (const payload of ['data: invalid\n\n', 'data: {"candidates":[{"finishReason":"SAFETY"}]}\n\n', 'x'.repeat(1_000_001)]) {
    let cancelled = false;
    t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
      start(c) { c.enqueue(new TextEncoder().encode(payload)); },
      cancel() { cancelled = true; },
    })));
    await assert.rejects(geminiGenerate({ apiKey: 'test', user: 'Hello', onText() {} }));
    assert.equal(cancelled, true);
    t.mock.restoreAll();
  }
});

test('thinking parts are not published and aborted requests reject', async t => {
  const updates = [];
  t.mock.method(globalThis, 'fetch', async () => new Response(
    'data: {"candidates":[{"content":{"parts":[{"thought":true,"text":"private thinking"},{"text":"OK"}]}}]}\n\n',
  ));
  assert.equal(await geminiGenerate({ apiKey: 'test', user: 'Hello', onText: text => updates.push(text) }), 'OK');
  assert.deepEqual(updates, ['OK']);
  const abort = new AbortController();
  t.mock.method(globalThis, 'fetch', async (_url, opts) => new Response(new ReadableStream({
    start(c) { opts.signal.addEventListener('abort', () => c.error(opts.signal.reason), { once: true }); },
  })));
  const pending = geminiGenerate({ apiKey: 'test', user: 'Hello', signal: abort.signal, onText() {} });
  await settle(); abort.abort();
  await assert.rejects(pending, { name: 'AbortError' });
});
