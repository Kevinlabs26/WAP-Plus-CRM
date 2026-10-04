import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
const mocks = {
  "@/lib/storage": "export const getStorageEngine = () => 'sqlite'; export const saveAppState = async (value) => { await globalThis.restoreBeforeSave?.(); if (globalThis.restoreFail) { globalThis.restoreFail = false; throw new Error('Disk full'); } globalThis.restoreSaved = value; }; export const loadAppState = async () => null; export const clearAppState = async () => {}; export const clearStoredRemoteMessages = async () => {}; export const deleteStoredMessagesByKeys = async () => {}; export const updateStoredMessageAcks = async (items, accountId) => { globalThis.syncAckWritten = { items, accountId }; await globalThis.syncAckWait?.(); }; export const loadSecureSecrets = async () => null; export const saveSecureSecrets = async () => true;",
  "@/lib/mediaCache": "export const bridgeMessageMediaCacheId = (id, accountId) => accountId + ':' + id; export const readMediaCache = async id => globalThis.restoreMedia.get(id); export const cacheMediaUrl = async (id, url) => { if (globalThis.restoreMediaFail) throw new Error('Media disk full'); globalThis.restoreMedia.set(id, url); }; export const dropMediaCache = async id => { globalThis.restoreMedia.delete(id); };",
  "@/lib/composerActivity": "export const isComposerTypingBusy = () => false;",
  "@/lib/syncDebug": "export const noteMainThreadWork = () => {}; export const syncLog = () => {}; export const isSyncDebugEnabled = () => false;",
  "@/lib/aiAutoReply": "export const emitLiveInboundMessages = () => {};",
  "@/lib/inboundMessageNotify": "export const notifyInboundMessages = () => {};",
};
const built = await build({
  stdin: { contents: 'export { createBootSlice } from "./src/store/bootSlice.ts"; export { createIngestSlice } from "./src/store/ingestSlice.ts"; export { isDataRestoreActive } from "./src/store/restoreGuard.ts"; export { persist } from "./src/store/persist.ts"; export { assertSendGate, withSendGate } from "./src/channels/sendGate.ts"; export { defaultSettings } from "./src/store/settingsDefaults.ts";', resolveDir: fileURLToPath(new URL("../", import.meta.url)) },
  bundle: true, format: "esm", platform: "browser", write: false,
  plugins: [{ name: "restore-mocks", setup(b) {
    b.onResolve({ filter: /.*/ }, args => mocks[args.path] ? { path: args.path, namespace: "mock" } : undefined);
    b.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ contents: mocks[args.path], loader: "js" }));
  } }], alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) },
  external: ["@tauri-apps/api/core"],
});
const { createBootSlice, createIngestSlice, defaultSettings, isDataRestoreActive, persist, assertSendGate, withSendGate } = await import("data:text/javascript;base64," + Buffer.from(built.outputFiles[0].text).toString("base64"));
function setup() {
  globalThis.syncAckWritten = undefined; globalThis.syncAckWait = undefined;
  globalThis.window = { setTimeout, requestIdleCallback: undefined };
  globalThis.restoreBeforeSave = undefined; globalThis.restoreFail = false; globalThis.restoreMediaFail = false; globalThis.restoreSaved = null; globalThis.restoreMedia = new Map();
  let state = { hydrated: false, phones: [], contacts: [{ id: 'original' }], chats: [], messages: [], followUps: [], activities: [], broadcastCampaigns: [], scheduledMessages: [], draftReplyByChatId: { original: 'keep on failure' },
    settings: { ...defaultSettings, aiReplyMode: 'auto', customAiKey: 'private-ai-key', openaiKey: 'private-key', bridgeToken: 'private-token', customAiBaseUrl: 'https://local.invalid', waAccounts: [{ id: 'wa', label: 'local', status: 'connected', warmupExempt: false, createdAt: '2026-09-30T00:00:00Z' }], activeAccountId: 'wa', liveBaileysAccountId: 'wa' },
    recomputeStats() {}, pushToast() {}, peerPresenceByKey: {}, baileysUi: {},
  };
  const ctx = { get: () => state, set: patch => { state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) }; } };
  state = { ...state, ...createBootSlice(ctx), ...createIngestSlice(ctx) }; return ctx;
}
const mediaUrl = 'data:image/png;base64,' + 'A'.repeat(9000);
const backup = { version: 2, contacts: [{ id: 'restored', name: 'Restored', phone: '00123', stage: 'new' }],
  messages: [{ id: 'media', chatId: 'chat', direction: 'in', body: '', sentAt: '2026-10-01T00:00:00Z', mediaUrl, mediaType: 'image' }],
  settingsSafe: { aiReplyMode: 'auto', customAiBaseUrl: 'https://evil.invalid', bridgeToken: 'evil', waAccounts: [{ id: 'wa', label: 'backup', status: 'connected', warmupExempt: true, createdAt: '2000-01-01T00:00:00Z' }], scheduledMessages: [{ id: 'task', chatId: 'chat', contactId: 'restored', recipient: '00123', text: 'Hi', dueAt: '2026-10-01T00:00:00Z', status: 'pending' }] },
};
test('restore preserves local credentials and protections, persists no keys and caches media', async () => {
  const { get } = setup(); assert.deepEqual(await get().importBackup(backup), { ok: true });
  const settings = get().settings;
  assert.equal(settings.customAiBaseUrl, 'https://local.invalid'); assert.equal(settings.bridgeToken, 'private-token'); assert.equal(settings.customAiKey, 'private-ai-key'); assert.equal(settings.aiReplyMode, 'semi');
  assert.equal(settings.waAccounts[0].warmupExempt, false); assert.equal(settings.waAccounts[0].createdAt, '2026-09-30T00:00:00Z');
  assert.equal(settings.scheduledMessages[0].status, 'failed');
  for (const key of ['customAiKey', 'openaiKey', 'bridgeToken']) assert.equal(globalThis.restoreSaved.settings[key], '');
  assert.equal(globalThis.restoreSaved.messages[0].mediaUrl, undefined);
  assert.equal(globalThis.restoreMedia.get('media'), mediaUrl);
  assert.deepEqual(globalThis.restoreSaved.draftReplyByChatId, {});
  assert.deepEqual(get().draftReplyByChatId, {});
});
test('failed restore preserves original data and previous cached attachments', async () => {
  const { get } = setup(); const original = get().contacts;
  globalThis.restoreMedia.set('media', 'data:image/png;base64,OLD'); globalThis.restoreFail = true;
  assert.equal((await get().importBackup(backup)).ok, false);
  assert.equal(get().contacts, original); assert.equal(get().settings.aiReplyMode, 'auto');
  assert.equal(globalThis.restoreMedia.get('media'), 'data:image/png;base64,OLD');
  assert.deepEqual(get().draftReplyByChatId, { original: 'keep on failure' });
});
test('media write failure stops restore before writing the database', async () => {
  const { get } = setup(); globalThis.restoreMediaFail = true;
  assert.equal((await get().importBackup(backup)).ok, false);
  assert.equal(globalThis.restoreSaved, null); assert.equal(get().contacts[0].id, 'original');
});

test('strict attachment restoration refuses eviction and propagates cache read failures', async () => {
  const media = await build({
    entryPoints: [fileURLToPath(new URL('../src/lib/mediaCache.ts', import.meta.url))], bundle: true, format: 'esm', platform: 'browser', write: false,
    plugins: [{ name: 'media-storage', setup(b) {
      b.onResolve({ filter: /^\.\/idb\.ts$/ }, () => ({ path: 'idb', namespace: 'media-mock' }));
      b.onLoad({ filter: /.*/, namespace: 'media-mock' }, () => ({ contents: "export const idbGet = async (key, strict) => { if (globalThis.mediaReadFail) { if (strict) throw new Error('Read failed'); return undefined; } return key === 'media-cache-index-v1' ? globalThis.mediaFullIndex : undefined; }; export const idbSet = async () => { globalThis.mediaWrites++; }; export const idbDel = async () => { globalThis.mediaDeletes++; }; export const idbDelPrefix = async () => 0; export const idbEntriesPrefix = async () => []; export const mediaCacheKey = id => 'media:' + id;" }));
    } }],
  });
  const { cacheMediaUrl, readMediaCache, MEDIA_CACHE_MAX_CHARS } = await import('data:text/javascript;base64,' + Buffer.from(media.outputFiles[0].text).toString('base64'));
  globalThis.mediaWrites = 0; globalThis.mediaDeletes = 0; globalThis.mediaReadFail = false;
  globalThis.mediaFullIndex = { existing: { chars: MEDIA_CACHE_MAX_CHARS, cachedAt: 0 } };
  await assert.rejects(cacheMediaUrl('new', mediaUrl, true), /空间不足/);
  assert.equal(globalThis.mediaWrites, 0); assert.equal(globalThis.mediaDeletes, 0);
  globalThis.mediaReadFail = true;
  await assert.rejects(readMediaCache('existing', true), /Read failed/);
  assert.equal(await readMediaCache('existing'), undefined);
});


test('failed restore keeps messages and settings received while its save was pending', async () => {
  const { get, set } = setup();
  const arriving = { id: 'arriving', chatId: 'live', direction: 'in', body: 'new inbound' };
  globalThis.restoreBeforeSave = async () => {
    set({ messages: [arriving], settings: { ...get().settings, theme: 'light' } });
    globalThis.restoreFail = true;
  };
  assert.equal((await get().importBackup(backup)).ok, false);
  assert.deepEqual(get().messages, [arriving]);
  assert.equal(get().settings.theme, 'light');
  assert.equal(get().contacts[0].id, 'original');
});

for (const fail of [false, true]) {
  test('restore ' + (fail ? 'failure' : 'success') + ' replays incoming messages and defers automatic saves', async () => {
    const { get, set } = setup();
    let queuedSave;
    globalThis.restoreBeforeSave = async () => {
      globalThis.restoreBeforeSave = undefined;
      assert.equal(isDataRestoreActive(), true);
      assert.equal(assertSendGate({ accountId: 'wa' }).error, 'send_paused');
      get().ingestBridgeEvents([{ type: 'messages.sync', deviceId: 'wa', ts: Date.now(), payload: { live: true, items: [{ id: 'arriving', phone: '+12025550123', body: 'new inbound', direction: 'in', sentAt: new Date().toISOString() }] } }]);
      assert.equal(get().messages.some(m => m.body === 'new inbound'), false);
      set({ hydrated: true });
      queuedSave = persist(get, true);
      globalThis.restoreFail = fail;
    };
    assert.equal((await get().importBackup(backup)).ok, !fail);
    assert.equal(isDataRestoreActive(), false);
    assert.equal(get().messages.some(m => m.body === 'new inbound'), true);
    assert.equal(get().contacts.some(c => c.id === (fail ? 'original' : 'restored')), true);
    await queuedSave;
    assert.equal(globalThis.restoreSaved.messages.some(m => m.body === 'new inbound'), true);
  });
}

test('overlapping restore and clear cannot replace an active restore', async () => {
  const { get } = setup();
  globalThis.restoreBeforeSave = async () => {
    globalThis.restoreBeforeSave = undefined;
    assert.equal((await get().importBackup(backup)).ok, false);
    await assert.rejects(get().clearData(), /正在恢复/);
    assert.equal(isDataRestoreActive(), true);
  };
  assert.equal((await get().importBackup(backup)).ok, true);
  assert.equal(isDataRestoreActive(), false);
});

test('restore waits for an existing send and blocks a new send', async () => {
  const { get } = setup();
  let releaseSend;
  let enteredSend;
  const entered = new Promise(resolve => { enteredSend = resolve; });
  const pending = withSendGate({ accountId: 'wa' }, { rateLimitEnabled: false, blockSendWhenOverheated: false }, async () => {
    enteredSend();
    await new Promise(resolve => { releaseSend = resolve; });
  });
  await entered;
  const restoring = get().importBackup(backup);
  assert.equal(isDataRestoreActive(), true);
  assert.equal(globalThis.restoreSaved, null);
  let called = false;
  const blocked = await withSendGate({ accountId: 'other' }, {}, async () => { called = true; });
  assert.equal(blocked.ok, false);
  assert.equal(called, false);
  releaseSend();
  await pending;
  assert.equal((await restoring).ok, true);
});

test('an already sliced sync pauses its remaining slices during restore', async () => {
  const { get } = setup();
  const timers = [];
  globalThis.window.setTimeout = action => { timers.push(action); return timers.length; };
  const items = Array.from({ length: 61 }, (_, i) => ({ id: 'slice-' + i, phone: '+12025550123', body: 'slice body ' + i, direction: 'in', sentAt: new Date().toISOString() }));
  get().ingestBridgeEvents([{ type: 'messages.sync', deviceId: 'wa', payload: { live: false, items } }]);
  assert.equal(get().messages.some(m => m.body === 'slice body 60'), false);
  globalThis.restoreBeforeSave = async () => {
    globalThis.restoreBeforeSave = undefined;
    timers.shift()();
    assert.equal(get().messages.some(m => m.body === 'slice body 60'), false);
  };
  assert.equal((await get().importBackup(backup)).ok, true);
  assert.equal(get().messages.some(m => m.body === 'slice body 60'), true);
  while (timers.length) timers.shift()();
});

test('ingest completion waits for the final sync slice', async () => {
  const {get}=setup(); const timers=[]; window.setTimeout=fn=>{timers.push(fn); return timers.length;};
  const items=Array.from({length:61},(_,i)=>({id:'complete-'+i,phone:'+12025550123',body:'complete '+i,direction:'in',sentAt:new Date().toISOString()}));
  let complete=false; const done=get().ingestBridgeEvents([{type:'messages.sync',deviceId:'wa',payload:{live:false,items}}]).then(()=>{complete=true;});
  await Promise.resolve(); assert.equal(complete,false);
  while(timers.length)timers.shift()(); await done;
  assert.equal(get().messages.some(m=>m.body==='complete 60'),true);
});

test('cold ACK completion waits for database update and includes its account', async () => {
  const {get}=setup(); let release; let complete=false;
  globalThis.syncAckWait=()=>new Promise(resolve=>{release=resolve;});
  const done=get().ingestBridgeEvents([{type:'messages.ack',deviceId:'wa',payload:{items:[{id:'cold',status:4}]}}]).then(()=>{complete=true;});
  assert.deepEqual(globalThis.syncAckWritten,{accountId:'wa',items:[{id:'cold',ack:'read'}]});
  await Promise.resolve(); assert.equal(complete,false); release(); await done;
});

test('replayed clear preserves newer messages and isolates accounts', async () => {
  const {get,set}=setup(); const make=(id,accountId,sentAt)=>({id,accountId,sentAt,chatId:'chat',body:id,direction:'in',waKey:{remoteJid:'123@s.whatsapp.net'}});
  set({messages:[make('old','wa','2026-10-01T00:00:00Z'),make('new','wa','2026-10-01T00:00:01.000Z'),make('other','wa-b','2026-10-01T00:00:00Z')]});
  await get().ingestBridgeEvents([{type:'messages.delete',deviceId:'wa',payload:{all:true,jid:'123@s.whatsapp.net',deletedBefore:'2026-10-01T00:00:00.000Z'}}]);
  assert.deepEqual(get().messages.map(m=>m.id),['new','other']);
});
