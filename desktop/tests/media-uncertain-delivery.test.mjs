import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Actual runtime/request, send commands, media gate and initial senders;
// only native startup, gate policy and browser I/O are controlled.
const sourceRoot = fileURLToPath(new URL('../src', import.meta.url));
const mocks = {
  '@/lib/bridge': `export const isTauri = () => globalThis.mediaNative;
    export const bridgeInvoke = (...args) => globalThis.mediaRuntime(...args);`,
  '@/lib/syncDebug': 'export const syncLog = () => {};',
  '@/store/appStore': `export const useAppStore = { getState: () => ({settings: {}, messages: []}) };`,
  '@/i18n': 'export const translateCurrent = (key, params) => params?.reason ? `${key}: ${params.reason}` : key;',
  './index': 'export const sendRuntimeFromSettings = () => ({});',
  './sendGate': `export const withSendGate = async (_input, _runtime, send) => globalThis.mediaGatePaused
    ? {ok: false, gate: {error: 'send_paused', reason: 'sending paused'}} : {ok: true, result: await send()};`,
};
const built = await build({
  stdin: { contents: `export { request, resetBaileysRuntimeCache } from './src/lib/baileysCore.ts';
    export { sendFileMessage } from './src/components/chat/sendFileMessage.ts';
    export { sendImageMessage } from './src/components/chat/sendImageMessage.ts';
    export { sendAudioMessage } from './src/components/chat/sendAudioMessage.ts';
    export { finishVoiceRecording } from './src/components/chat/endVoiceRecording.ts';
    export { sendProductMessage } from './src/components/chat/sendProductMessage.ts';
    export { sendGifMessage } from './src/components/chat/sendGifMessage.ts';`, resolveDir: fileURLToPath(new URL('../', import.meta.url)) },
  bundle: true, write: false, format: 'esm', platform: 'browser',
  alias: { '@': sourceRoot, '@shared': fileURLToPath(new URL('../../shared', import.meta.url)), '@/lib/baileys': `${sourceRoot}/lib/baileysSend.ts` },
  plugins: [{ name: 'controlled-media-boundaries', setup(b) {
    b.onResolve({filter: /.*/}, args => mocks[args.path] ? {path: args.path, namespace: 'mock'} : undefined);
    b.onLoad({filter: /.*/, namespace: 'mock'}, args => ({contents: mocks[args.path]}));
  } }],
});
const { request, resetBaileysRuntimeCache, sendFileMessage, sendImageMessage, sendAudioMessage, sendGifMessage, finishVoiceRecording, sendProductMessage } =
  await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
const originalGlobals = {fetch: globalThis.fetch, FileReader: globalThis.FileReader, document: globalThis.document, window: globalThis.window};
let fetchCalls;
beforeEach(() => {
  resetBaileysRuntimeCache(); fetchCalls = [];
  globalThis.mediaNative = true; globalThis.mediaGatePaused = false; globalThis.mediaReadFailure = false;
  globalThis.mediaRuntime = async () => ({baseUrl: 'http://127.0.0.1:1234', token: 'fixture-only'});
  globalThis.fetch = async (...args) => {fetchCalls.push(args); return new Response(JSON.stringify({ok: true, id: 'wa-id'}));};
  globalThis.FileReader = class { readAsDataURL(file) {
    queueMicrotask(() => { if (globalThis.mediaReadFailure) this.onerror();
      else {this.result = `data:${file.type};base64,ZmFrZQ==`; this.onload();} });
  } };
  globalThis.document = {createElement: () => ({duration: 30, remove() {}, set src(_url) {queueMicrotask(() => this.onloadedmetadata());}})};
  globalThis.window = {setTimeout: fn => {queueMicrotask(fn); return 1;}};
});
afterEach(() => {Object.assign(globalThis, originalGlobals); resetBaileysRuntimeCache();});
const sendRequest = signal => request('/send', {method: 'POST', ...(signal ? {signal} : {}), body: '{}'}, 'wa-original');

test('missing native runtime and an already aborted signal never mark a send as uncertain or call fetch', async () => {
  globalThis.mediaNative = false;
  await assert.rejects(sendRequest(), error => {assert.notEqual(error.deliveryUncertain, true); return /桌面壳/.test(error.message);});
  globalThis.mediaNative = true; globalThis.mediaRuntime = async () => {throw new Error('runtime failed');};
  await assert.rejects(sendRequest(), error => {assert.notEqual(error.deliveryUncertain, true); return error.message === 'runtime failed';});
  globalThis.mediaRuntime = async () => ({baseUrl: 'http://127.0.0.1:1234', token: 'fixture'});
  const controller = new AbortController(); controller.abort();
  await assert.rejects(sendRequest(controller.signal), error => {assert.notEqual(error.deliveryUncertain, true); return error.name === 'AbortError';});
  assert.equal(fetchCalls.length, 0);
});

test('a definite 4xx rejection retains HTTP status and remains safe to retry', async () => {
  for (const status of [400, 401, 409, 422, 429]) {
    globalThis.fetch = async (...args) => {fetchCalls.push(args); return new Response(JSON.stringify({error: 'controlled rejection'}), {status});};
    await assert.rejects(sendRequest(), error => {
      assert.equal(error.status, status); assert.equal(error.message, 'controlled rejection'); assert.notEqual(error.deliveryUncertain, true); return true;
    });
  }
  assert.equal(fetchCalls.length, 5);
});

test('fetch failure after send start is marked once and its wrapped error preserves source details', async () => {
  const original = Object.assign(new TypeError('Failed to fetch'), {code: 'ECONNRESET', detail: {reason: 'fixture'}});
  globalThis.fetch = async (...args) => {fetchCalls.push(args); throw original;};
  await assert.rejects(sendRequest(), error => {
    assert.equal(error.deliveryUncertain, true); assert.equal(error.code, 'ECONNRESET'); assert.equal(error.detail, original.detail);
    assert.equal(error.cause, original); assert.match(error.message, /无法连接 Baileys.*Failed to fetch/); return true;
  });
  assert.equal(fetchCalls.length, 1);
});

test('timeout or cancellation after fetch starts keeps the original error and requires verification', async () => {
  for (const name of ['TimeoutError', 'AbortError']) {
    const original = new DOMException('controlled interruption', name);
    globalThis.fetch = async (...args) => {fetchCalls.push(args); throw original;};
    await assert.rejects(sendRequest(), error => {assert.equal(error, original); assert.equal(error.deliveryUncertain, true); return true;});
  }
  assert.equal(fetchCalls.length, 2);
});

test('5xx and successful HTTP responses with an invalid send acknowledgement remain uncertain without automatic replay', async () => {
  for (const [status, body] of [[500, '{"error":"server failed"}'], [503, '{"error":"server unavailable"}'],
    [200, 'truncated'], [200, '{}'], [200, '{"ok":false}'], [200, 'null']]) {
    globalThis.fetch = async (...args) => {fetchCalls.push(args); return new Response(body, {status});};
    await assert.rejects(sendRequest(), error => {assert.equal(error.deliveryUncertain, true); if (status >= 500) assert.equal(error.status, status); return true;});
  }
  assert.equal(fetchCalls.length, 6);
  await assert.rejects(request('/catalog/send', {method: 'POST'}, 'wa-product'), error => error.deliveryUncertain === true);
});

test('optional send IDs are accepted, while other API paths retain existing response and read retry behavior', async () => {
  globalThis.fetch = async (...args) => {fetchCalls.push(args); return new Response('{"ok":true}');};
  assert.deepEqual(await sendRequest(), {ok: true});
  assert.deepEqual(await request('/catalog/send', {method: 'POST'}, 'wa-product'), {ok: true});
  globalThis.fetch = async (...args) => {fetchCalls.push(args); return new Response('invalid json');};
  assert.deepEqual(await request('/presence', {method: 'POST'}, 'wa-original'), {});
  let reads = 0;
  globalThis.fetch = async (...args) => {fetchCalls.push(args); if (++reads === 1) throw new TypeError('Failed to fetch'); return new Response('{"ok":true}');};
  assert.deepEqual(await request('/status', undefined, 'wa-original'), {ok: true}); assert.equal(reads, 2);
});

function mediaDeps() {
  const updates = [], toasts = [], drafts = [], busy = [], patches = [];
  return {updates, toasts, drafts, busy, patches, sending: false, stickToBottom() {}, guardBlockedSend: () => true,
    resolveRecipient: () => ({contact: {id: 'contact'}, recipient: '+33600000000'}),
    pushToast: (...args) => toasts.push(args), isBaileys: true, chatConnected: true, setBaileysLoginOpen: assert.fail,
    setSending: flag => busy.push(flag), getDraftReply: () => 'keep caption', setDraftReply: text => drafts.push(text),
    enqueueOutgoingMessage: () => 'message', patchMessage: (...args) => patches.push(args),
    updateMessageDelivery: (_id, patch) => updates.push(patch), channelId: 'baileys', selectedPhoneId: null,
    chatId: 'chat', chatAccountId: 'wa-original', openAndroidMediaShare: assert.fail,
    toStickerDataUrl: async () => 'data:image/webp;base64,ZmFrZQ==' };
}
async function sendMedia(kind, deps) {
  const type = {file: 'application/pdf', image: 'image/png', sticker: 'image/webp', audio: 'audio/mp3', gif: 'image/gif'}[kind];
  const file = new File(['fixture'], `fixture.${kind}`, {type});
  if (kind === 'file') return sendFileMessage(file, 'keep caption', deps);
  if (kind === 'image' || kind === 'sticker') return sendImageMessage(file, kind === 'sticker', 'keep caption', deps);
  if (kind === 'audio') return sendAudioMessage(file, 'keep caption', deps);
  return sendGifMessage({...deps, file, caption: 'keep caption', contact: {id: 'contact'}, recipient: '+33600000000'});
}

for (const kind of ['file', 'image', 'sticker', 'audio', 'gif']) test(`initial ${kind} sender persists the structured unknown result, preserves caption and releases its busy state`, async () => {
  const deps = mediaDeps();
  globalThis.fetch = async (...args) => {fetchCalls.push(args); throw new TypeError('Failed to fetch');};
  assert.equal(await sendMedia(kind, deps), false);
  assert.equal(fetchCalls.length, 1); assert.equal(deps.updates.at(-1).deliveryStatus, 'failed');
  assert.equal(deps.updates.at(-1).deliveryUncertain, true); assert.match(deps.updates.at(-1).lastError, /Failed to fetch/);
  assert.deepEqual(deps.drafts, []); assert.deepEqual(deps.busy, [true, false]);
});

for (const kind of ['file', 'image', 'sticker', 'audio', 'gif']) test(`initial ${kind} sender distinguishes gate and HTTP rejection from an uncertain send`, async () => {
  globalThis.mediaGatePaused = true; const paused = mediaDeps();
  assert.equal(await sendMedia(kind, paused), false); assert.equal(fetchCalls.length, 0);
  assert.equal(paused.updates.at(-1).deliveryUncertain, false); assert.equal(paused.updates.at(-1).lastError, 'sending paused');
  globalThis.mediaGatePaused = false;
  globalThis.fetch = async (...args) => {fetchCalls.push(args); return new Response('{"error":"controlled rejection"}', {status: 400});};
  const rejected = mediaDeps(); assert.equal(await sendMedia(kind, rejected), false);
  assert.equal(rejected.updates.at(-1).deliveryUncertain, false); assert.equal(fetchCalls.length, 1);
  assert.deepEqual(rejected.drafts, []);
});

test('file read errors happen before transmission and do not claim uncertain delivery', async () => {
  globalThis.mediaReadFailure = true; const deps = mediaDeps();
  assert.equal(await sendMedia('file', deps), false); assert.equal(fetchCalls.length, 0);
  assert.deepEqual(deps.updates, []); assert.deepEqual(deps.busy, [true, false]); assert.equal(deps.toasts.length, 1);
});

test('recorded voice retains an unknown send result and releases recording state', async () => {
  const deps = {...mediaDeps(), setRecording() {}, setRecordSec() {}};
  const session = {cancel: assert.fail, stop: async () => ({durationSec: 30, byteLength: 500,
    dataUrl: 'data:audio/webm;base64,ZmFrZQ==', mimeType: 'audio/webm'})};
  globalThis.fetch = async (...args) => {fetchCalls.push(args); throw new TypeError('Failed to fetch');};
  await finishVoiceRecording(true, session, deps);
  assert.equal(fetchCalls.length, 1); assert.equal(deps.updates.at(-1).deliveryUncertain, true);
  assert.equal(deps.updates.at(-1).deliveryStatus, 'failed'); assert.deepEqual(deps.busy, [true, false]);
});

test('product sends explain uncertainty without claiming success or replaying the request', async () => {
  const deps = {...mediaDeps(), product: {id: 'product', name: '虚构商品', price: 0},
    contact: {id: 'contact'}, recipient: '+33600000000', caption: 'test-only'};
  globalThis.fetch = async (...args) => {fetchCalls.push(args); throw new TypeError('Failed to fetch');};
  await assert.rejects(sendProductMessage(deps), error => error.deliveryUncertain === true);
  assert.equal(fetchCalls.length, 1); assert.match(deps.toasts.at(-1)[0], /runtime.sendUnknown/);
  assert.deepEqual(deps.patches, []); assert.deepEqual(deps.busy, [true, false]);
});
