import assert from 'node:assert/strict';
import test from 'node:test';
import { readAiJson } from '../src/lib/aiResponse.ts';
import { generateSuggestions } from '../src/lib/aiSuggest.ts';
import { listProviderModels } from '../src/lib/listModels.ts';

test('AI JSON handles UTF-8 chunk boundaries and cancels oversized streams without trusting Content-Length', async () => {
  const value = { text: '你好，世界。', data: [1, 2] };
  const encoded = new TextEncoder().encode(JSON.stringify(value));
  const valid = new Response(new ReadableStream({ start(c) { for (const byte of encoded) c.enqueue(Uint8Array.of(byte)); c.close(); } }));
  assert.deepEqual(await readAiJson(valid), value);
  for (const headers of [{}, { 'content-length': '1' }, { 'content-length': '1000001' }]) {
    let cancelled = false;
    const response = new Response(new ReadableStream({
      start(c) { c.enqueue(new Uint8Array(1_000_001)); },
      cancel() { cancelled = true; },
    }), { headers });
    await assert.rejects(readAiJson(response), /1 MB/);
    assert.equal(cancelled, true);
    assert.equal(response.body.locked, false);
  }
});

test('AI JSON rejects invalid, empty and failed streams without returning response content', async () => {
  for (const body of ['', 'not-json']) await assert.rejects(readAiJson(new Response(body)), SyntaxError);
  await assert.rejects(readAiJson(new Response(null)), /空响应/);
  const response = new Response(new ReadableStream({ start(c) { c.error(Error('transport failed')); } }));
  await assert.rejects(readAiJson(response), /transport failed/);
  assert.equal(response.body.locked, false);
});

test('an oversized compatible JSON response fails closed instead of publishing suggestions', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ choices: [{ message: { content: 'x'.repeat(1_000_001) } }] }));
  const result = await generateSuggestions(undefined, [], { aiProvider: 'custom', customAiKey: 'fixture', customAiBaseUrl: 'https://example.invalid/v1', customAiModel: 'fixture', aiSystemPrompt: 'Use my context.' });
  assert.equal(result.fallback, true);
  assert.deepEqual(result.suggestions, []);
  assert.match(result.error, /1 MB/);
});

test('model lists never expose untrusted objects as React labels and malformed lists remain empty', async t => {
  const settings = { aiProvider: 'custom', customAiKey: 'fixture', customAiBaseUrl: 'https://example.invalid/v1', customAiModel: 'fixture', geminiKey: 'fixture', ollamaUrl: 'http://127.0.0.1:11434' };
  for (const provider of ['custom', 'gemini', 'ollama']) {
    t.mock.method(globalThis, 'fetch', async () => Response.json(provider === 'custom'
      ? { data: [null, { id: {} }, { id: 123 }, { id: ' ' }, { id: 'valid-model' }] }
      : { models: [null, { name: {} }, { name: 123 }, { name: 'valid-model', supportedGenerationMethods: ['generateContent'] }] }));
    assert.deepEqual(await listProviderModels(provider, settings), [{ id: 'valid-model', label: 'valid-model' }]);
    t.mock.restoreAll();
    for (const malformed of [null, { data: {}, models: {} }]) {
      t.mock.method(globalThis, 'fetch', async () => Response.json(malformed));
      assert.deepEqual(await listProviderModels(provider, settings), []);
      t.mock.restoreAll();
    }
  }
});
