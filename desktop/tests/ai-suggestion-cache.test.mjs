import assert from 'node:assert/strict';
import test from 'node:test';
import { createSuggestionCache, markManualSuggestionContext, isManualSuggestionContext, SUGGESTION_MAX_AGE_MS } from '../src/lib/aiSuggestionCache.ts';

const result = { suggestions: [{ text: 'A full reply' }], source: 'custom', fallback: false };

test('clock-aware cache expires five minutes after generation starts and rejects results completed after sleep',async t=>{
  let now=100000;t.mock.method(Date,'now',()=>now);const cache=createSuggestionCache();let calls=0;
  const generate=async()=>{calls++;return result;};await cache.request('same',generate);
  now+=SUGGESTION_MAX_AGE_MS-1;assert.ok(cache.get('same'));await cache.request('same',generate);assert.equal(calls,1);
  now++;assert.equal(cache.get('same'),undefined);await cache.request('same',generate);assert.equal(calls,2);
  now-=1;assert.equal(cache.get('same'),undefined,'clock moving backwards also invalidates a snapshot');
  let finish;const pending=cache.request('sleep',()=>new Promise(resolve=>{finish=resolve;}));now+=SUGGESTION_MAX_AGE_MS;
  finish(result);await assert.rejects(pending,/expired/);assert.equal(cache.get('sleep'),undefined);
});

test('suggestions share pending work, reuse completed replies and honor explicit regeneration', async () => {
  const cache = createSuggestionCache(); let resolve, calls = 0;
  const generate = () => { calls++; return new Promise(done => { resolve = done; }); };
  const first = cache.request('context', generate);
  assert.equal(cache.request('context', generate, true), first, 'refresh cannot duplicate an unfinished request');
  assert.equal(calls, 1); resolve(result); assert.equal(await first, result);
  assert.equal(await cache.request('context', generate), result); assert.equal(calls, 1);
  const refresh = cache.request('context', generate, true); assert.equal(calls, 2);
  resolve(result); await refresh;
});

test('cache stays bounded, keeps recently used results and never retains fallback, demo or failed replies', async () => {
  const cache = createSuggestionCache();
  for (let i = 0; i < 24; i++) await cache.request(String(i), async () => result);
  cache.get('0'); await cache.request('24', async () => result);
  assert.ok(cache.get('0')); assert.equal(cache.get('1'), undefined);
  for (const value of [{ ...result, fallback: true }, { ...result, source: 'mock' }]) {
    await cache.request('failure', async () => value); assert.equal(cache.get('failure'), undefined);
  }
  await assert.rejects(cache.request('reject', async () => { throw new Error('offline'); }), /offline/);
  assert.equal(cache.get('reject'), undefined);
  assert.equal(await cache.request('reject', async () => result), result);
});

test('manual suppression is bounded and applies only to an identical context', () => {
  for (let i = 0; i < 25; i++) markManualSuggestionContext(`manual-${i}`);
  assert.equal(isManualSuggestionContext('manual-0'), false);
  assert.equal(isManualSuggestionContext('manual-24'), true);
  assert.equal(isManualSuggestionContext('new-context'), false);
});

test('pending cache replays streaming progress to returning consumers without another request', async () => {
  const cache = createSuggestionCache(); let publish, resolve;
  const firstUpdates = [], returningUpdates = [];
  const pending = cache.request('stream', notify => {
    publish = notify; return new Promise(done => { resolve = done; });
  }, false, value => firstUpdates.push(value));
  publish(result);
  assert.equal(cache.request('stream', () => { throw new Error('duplicate request'); }, true,
    value => returningUpdates.push(value)), pending);
  assert.deepEqual(returningUpdates, [result]);
  const next = { ...result, suggestions: [{ text: 'second' }] };
  publish(next);
  assert.equal(firstUpdates.at(-1), next);
  assert.equal(returningUpdates.at(-1), next);
  resolve(next); await pending;
  publish(result);
  assert.equal(returningUpdates.length, 2, 'finished requests release progress subscribers');
});

test('cancelling pending suggestions aborts transport, rejects late results and retains completed cache entries', async () => {
  const cache = createSuggestionCache(); let signal, publish, finish;
  const updates = [];
  const old = cache.request('cancel', (notify, transport) => {
    signal = transport; publish = notify;
    return new Promise(resolve => { finish = resolve; });
  }, false, value => updates.push(value));
  const rejected = assert.rejects(old, { name: 'AbortError' });
  cache.cancelPending('cancel');
  assert.equal(signal.aborted, true); assert.equal(cache.get('cancel'), undefined);
  publish(result); assert.deepEqual(updates, []);
  const retry = await cache.request('cancel', async () => result);
  finish(result); await rejected;
  assert.equal(cache.get('cancel').result, retry, 'an obsolete completion cannot evict the new result');
  cache.cancelPending('cancel'); assert.equal(cache.get('cancel').result, result);
});
