import assert from 'node:assert/strict';
import test from 'node:test';
import { generateSuggestions } from '../src/lib/aiSuggest.ts';

const settings = { aiProvider: 'custom', customAiBaseUrl: 'https://example.invalid/v1', customAiKey: 'test-only', customAiModel: 'configured-model', aiSystemPrompt: 'Reply naturally.' };
const event = (content, finish_reason = null) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason }] })}\r\n\r\n`;
const settle = () => new Promise(resolve => setImmediate(resolve));

test('compatible endpoints show a complete first suggestion before the remaining response arrives', async t => {
  let controller, body;
  t.mock.method(globalThis, 'fetch', async (_url, opts) => {
    body = JSON.parse(opts.body);
    return new Response(new ReadableStream({ start(c) { controller = c; } }), { headers: { 'content-type': 'text/event-stream; charset=utf-8' } });
  });
  const updates = []; let finished = false;
  const pending = generateSuggestions(undefined, [], settings, { onProgress: value => updates.push(value) })
    .then(value => { finished = true; return value; });
  await settle(); assert.equal(body.stream, true);
  const first = '你好，引用 "{不是对象}"。';
  for (const byte of new TextEncoder().encode(event('[' + JSON.stringify({ text: first }) + ','))) controller.enqueue(Uint8Array.of(byte));
  await settle();
  assert.equal(finished, false);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].source, 'custom');
  assert.equal(updates[0].suggestions[0].text, first);
  controller.enqueue(new TextEncoder().encode(event('{"text":"还没有完成')));
  await settle(); assert.equal(updates.length, 1);
  controller.enqueue(new TextEncoder().encode(event('"},{"text":"第三条"}]', 'stop') + 'data: [DONE]'));
  controller.close();
  const result = await pending;
  assert.equal(result.fallback, false);
  assert.equal(result.suggestions.length, 3);
  assert.equal(updates.at(-1).suggestions.length, 3);
});

test('JSON-only servers and explicit streaming rejection retain ordinary suggestions without retrying auth errors', async t => {
  for (const status of [200, 400, 422, 401]) {
    const bodies = [];
    t.mock.method(globalThis, 'fetch', async (_url, opts) => {
      bodies.push(JSON.parse(opts.body));
      if (bodies.length === 1 && status !== 200) return Response.json({ error: { message: 'stream is unsupported' } }, { status });
      return Response.json({ choices: [{ message: { content: '[{"text":"OK"}]' } }] });
    });
    const result = await generateSuggestions(undefined, [], settings, { onProgress() {} });
    assert.equal(result.fallback, status === 401);
    assert.equal(bodies.length, [400, 422].includes(status) ? 2 : 1);
    if (bodies.length === 2) assert.equal(bodies[1].stream, undefined);
    t.mock.restoreAll();
  }
});

test('malformed, blocked, oversized and truncated streams cannot become cached successful results', async t => {
  for (const payload of ['data: invalid\n\n', 'data: {"error":{"message":"failed"}}\n\n', event('', 'content_filter'), 'x'.repeat(1_000_001), event('[{"text":"Unfinished transport"}]')]) {
    let cancelled = false;
    t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
      start(c) { c.enqueue(new TextEncoder().encode(payload)); if (payload.includes('Unfinished transport')) c.close(); },
      cancel() { cancelled = true; },
    }), { headers: { 'content-type': 'text/event-stream' } }));
    const result = await generateSuggestions(undefined, [], settings, { onProgress() {} });
    assert.equal(result.fallback, true);
    assert.deepEqual(result.suggestions, []);
    if (!payload.includes('Unfinished transport')) assert.equal(cancelled, true);
    t.mock.restoreAll();
  }
});

test('stream abort propagates instead of returning a fallback', async t => {
  const abort = new AbortController();
  t.mock.method(globalThis, 'fetch', async (_url, opts) => new Response(new ReadableStream({
    start(c) { opts.signal.addEventListener('abort', () => c.error(opts.signal.reason), { once: true }); },
  }), { headers: { 'content-type': 'text/event-stream' } }));
  const pending = generateSuggestions(undefined, [], settings, { signal: abort.signal, onProgress() {} });
  await settle(); abort.abort();
  await assert.rejects(pending, { name: 'AbortError' });
});

test('callers without progress keep the non-streaming request', async t => {
  t.mock.method(globalThis, 'fetch', async (_url, opts) => {
    assert.equal(JSON.parse(opts.body).stream, undefined);
    return Response.json({ choices: [{ message: { content: '[{"text":"OK"}]' } }] });
  });
  assert.equal((await generateSuggestions(undefined, [], settings)).fallback, false);
});
