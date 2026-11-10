import assert from 'node:assert/strict';
import test from 'node:test';
import { generateSuggestions } from '../src/lib/aiSuggest.ts';
import { geminiGenerate } from '../src/lib/gemini.ts';
import { getAiUsageSnapshot, summarizeAiUsage } from '../src/lib/aiUsage.ts';

const settings = {
  aiProvider: 'custom', customAiBaseUrl: 'https://fixture.invalid/v1',
  customAiKey: 'fixture', customAiModel: 'fixture', aiSystemPrompt: 'Reply naturally.',
  openaiKey: 'fixture', aiModel: 'gpt-5.6-luna', geminiKey: 'fixture', ollamaUrl: 'http://localhost:11434',
};
const valid = '[{"text":"Bonjour !"}]';
const resultBody = (provider, content, reason) => provider === 'gemini'
  ? { candidates: [{ finishReason: reason, content: { parts: [{ text: content }] } }] }
  : provider === 'ollama' ? { done_reason: reason, message: { content } }
  : { choices: [{ finish_reason: reason, message: { content } }] };
const totals = () => { const value = getAiUsageSnapshot(); return summarizeAiUsage(value.buckets, value.rates); };

test('all suggestion providers leave room for complete multilingual JSON without changing the prompt or adding calls', async t => {
  for (const provider of ['custom', 'openai', 'gemini', 'ollama']) {
    for (const opts of [{}, { count: 1 }, { auto: true }, { auto: true, outreach: 'Say hello' }]) {
      let body, calls = 0;
      t.mock.method(globalThis, 'fetch', async (_url, request) => {
        body = JSON.parse(request.body); calls++;
        return Response.json(resultBody(provider, valid, provider === 'gemini' ? 'STOP' : 'stop'));
      });
      const result = await generateSuggestions(undefined, [], { ...settings, aiProvider: provider }, opts);
      assert.equal(result.fallback, false); assert.equal(calls, 1);
      const limit = body.max_completion_tokens ?? body.max_tokens ?? body.generationConfig?.maxOutputTokens ?? body.options?.num_predict;
      assert.equal(limit, opts.auto || opts.count === 1 ? 512 : 1536);
      const system = body.systemInstruction?.parts[0].text ?? body.messages[0].content;
      assert.ok(system.includes(settings.aiSystemPrompt));
      t.mock.restoreAll();
    }
  }
});

test('truncated or malformed JSON gets a readable error without repairing or publishing unfinished text', async t => {
  for (const provider of ['custom', 'gemini', 'ollama']) {
    for (const content of ['[{"text":"未完成的回复', '[{"text":"hello\\', '[{"text": invalid}]']) {
      let calls = 0;
      t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json(resultBody(provider, content)); });
      const result = await generateSuggestions(undefined, [], { ...settings, aiProvider: provider }, { auto: true });
      assert.equal(result.fallback, true); assert.deepEqual(result.suggestions, []);
      assert.match(result.error, /回复格式不完整或无效/);
      assert.doesNotMatch(result.error, /JSON at position|Unterminated|未完成的回复/);
      assert.equal(result.retryable, false); assert.equal(calls, 1);
      t.mock.restoreAll();
    }
  }
});

test('token-limit finish reasons reject even syntactically complete JSON for manual, auto and outreach callers', async t => {
  for (const provider of ['custom', 'gemini', 'ollama']) {
    for (const opts of [{}, { auto: true }, { auto: true, outreach: 'Say hello' }]) {
      let calls = 0;
      t.mock.method(globalThis, 'fetch', async () => {
        calls++; return Response.json(resultBody(provider, valid, provider === 'gemini' ? 'MAX_TOKENS' : 'length'));
      });
      const result = await generateSuggestions(undefined, [], { ...settings, aiProvider: provider }, opts);
      assert.equal(result.fallback, true); assert.deepEqual(result.suggestions, []);
      assert.match(result.error, /输出上限.*未完整生成/); assert.equal(calls, 1);
      t.mock.restoreAll();
    }
  }
});

test('compatible and Gemini streams retain final usage when rejecting a token-limited reply', async t => {
  for (const provider of ['custom', 'gemini']) {
    const before = totals(), updates = [];
    const first = provider === 'gemini'
      ? resultBody(provider, valid, 'MAX_TOKENS')
      : { choices: [{ index: 0, delta: { content: valid }, finish_reason: 'length' }] };
    const usage = provider === 'gemini'
      ? { usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 } }
      : { choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } };
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => {
      calls++; return new Response(`data: ${JSON.stringify(first)}\n\ndata: ${JSON.stringify(usage)}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
    });
    const result = await generateSuggestions(undefined, [], { ...settings, aiProvider: provider }, { onProgress: value => updates.push(value) });
    assert.equal(result.fallback, true); assert.deepEqual(result.suggestions, []);
    assert.match(result.error, /输出上限/); assert.equal(calls, 1); assert.equal(updates.length, 0);
    const after = totals(); assert.equal(after.total - before.total, 15); assert.equal(after.failed - before.failed, 1);
    t.mock.restoreAll();
  }
});

test('non-streaming blocked responses cannot publish otherwise valid replies, and Gemini callers share the truncation guard', async t => {
  for (const provider of ['custom', 'gemini']) {
    t.mock.method(globalThis, 'fetch', async () => Response.json(resultBody(provider, valid, provider === 'gemini' ? 'SAFETY' : 'content_filter')));
    const result = await generateSuggestions(undefined, [], { ...settings, aiProvider: provider });
    assert.equal(result.fallback, true); assert.deepEqual(result.suggestions, []); assert.match(result.error, /被阻止/);
    t.mock.restoreAll();
  }
  t.mock.method(globalThis, 'fetch', async () => Response.json(resultBody('gemini', '', 'MAX_TOKENS')));
  await assert.rejects(geminiGenerate({ apiKey: 'fixture', user: 'Hello' }), /输出上限/);
});
