import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const mocks = {
  '@tauri-apps/api/core': `export const invoke = async (command, args) => {
    if (globalThis.backupInvoke) return globalThis.backupInvoke(command, args);
    if(command === 'crm_backup_status') return globalThis.backupStatus;
    if(command === 'crm_backup_save') { globalThis.backupContent = args.content; return globalThis.backupStatus; }
    throw new Error(command);
  };`,
  './bridge': 'export const isTauri = () => true;',
  '@/lib/storage': 'export const loadFullHistory = async () => globalThis.backupHistoryRead ? globalThis.backupHistoryRead() : globalThis.backupHistory;',
  '@/lib/mediaCache': 'export const readMediaCache = async () => null; export const waitForMediaCacheWrites = async () => {};',
};
const built = await build({
  stdin: { contents: `export { runAutomaticBackup } from './src/lib/automaticBackup.ts';
    export { defaultSettings } from './src/store/settingsDefaults.ts';
    export { parseBackupJson } from './src/lib/exportData.ts';
    export { beginDataRestore } from './src/store/restoreGuard.ts';`, resolveDir: fileURLToPath(new URL('../', import.meta.url)) },
  bundle: true, write: false, format: 'esm', platform: 'browser',
  plugins: [{ name: 'backup-io', setup(b) {
    b.onResolve({ filter: /.*/ }, args => mocks[args.path] ? { path: args.path, namespace: 'mock' } : undefined);
    b.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path] }));
  } }],
  alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) },
});

const { runAutomaticBackup, defaultSettings, parseBackupJson, beginDataRestore } = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));

const stateFixture = () => ({ hydrated: true, phones: [], contacts: [], chats: [], messages: [], followUps: [],
  activities: [], broadcastCampaigns: [], settings: { ...defaultSettings } });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('backup write failure releases its lock and a later attempt succeeds', async () => {
  const state = stateFixture(), status = { folder: 'fixture', latestDay: null };
  let fail = true, saved = 0;
  globalThis.backupInvoke = async command => {
    if (command === 'crm_backup_status') return status;
    if (fail) throw new Error('controlled disk failure');
    saved++; return status;
  };
  try {
    await assert.rejects(runAutomaticBackup(() => state), /controlled disk failure/);
    fail = false; assert.deepEqual(await runAutomaticBackup(() => state), status); assert.equal(saved, 1);
  } finally { delete globalThis.backupInvoke; }
});

test('concurrent backups skip background work and reject a duplicate manual request', async () => {
  const state = stateFixture(), pending = deferred(), status = { folder: 'fixture', latestDay: null };
  let writes = 0;
  globalThis.backupInvoke = async command => { if (command === 'crm_backup_status') return pending.promise; writes++; return status; };
  try {
    const run = runAutomaticBackup(() => state);
    assert.equal(await runAutomaticBackup(() => state), null);
    await assert.rejects(runAutomaticBackup(() => state, true), /正在备份/);
    pending.resolve(status); await run; assert.equal(writes, 1);
  } finally { delete globalThis.backupInvoke; }
});

for (const finishBeforeRead of [false, true]) test(`backup skips an export overlapping restore even if restore has ${finishBeforeRead ? 'already completed' : 'not completed'}`, async () => {
  const state = stateFixture(), pending = deferred(), reading = deferred();
  let writes = 0, finish;
  globalThis.backupInvoke = async command => { if (command === 'crm_backup_status') return { folder: 'fixture', latestDay: null }; writes++; };
  globalThis.backupHistoryRead = () => { reading.resolve(); return pending.promise; };
  try {
    const run = runAutomaticBackup(() => state); await reading.promise;
    finish = beginDataRestore(); if (finishBeforeRead) { finish(); finish = null; }
    pending.resolve({ messages: [], activities: [] });
    assert.equal(await run, null); assert.equal(writes, 0);
  } finally { finish?.(); delete globalThis.backupInvoke; delete globalThis.backupHistoryRead; }
});
test('automatic backup includes cold history, excludes credentials, restores through existing parser and skips duplicate/disabled/restore runs', async () => {
  const state = { hydrated: true, phones: [], contacts: [], chats: [], messages: [], followUps: [], activities: [], broadcastCampaigns: [],
    settings: { ...defaultSettings, openaiKey: 'fixture-secret', bridgeToken: 'fixture-token' } };
  globalThis.backupStatus = { folder: 'fixture', latestDay: null };
  globalThis.backupHistory = { messages: [{ id: 'cold', chatId: 'chat', direction: 'in', body: 'cold history', sentAt: '2026-10-03T10:00:00Z' }], activities: [] };
  try {
    await runAutomaticBackup(() => state);
    assert.ok(!globalThis.backupContent.includes('fixture-secret'));
    assert.ok(!globalThis.backupContent.includes('fixture-token'));
    const restored = parseBackupJson(JSON.parse(globalThis.backupContent));
    assert.equal(restored.messages[0].body, 'cold history');
    delete globalThis.backupContent;
    globalThis.backupStatus.latestDay = new Date().toLocaleDateString('en-CA');
    await runAutomaticBackup(() => state);
    assert.equal(globalThis.backupContent, undefined);
    state.settings.automaticBackupEnabled = false;
    globalThis.backupStatus.latestDay = null;
    assert.equal(await runAutomaticBackup(() => state), null);
    const finish = beginDataRestore();
    try { assert.equal(await runAutomaticBackup(() => state, true), null); }
    finally { finish(); }
  } finally { delete globalThis.backupContent; delete globalThis.backupStatus; delete globalThis.backupHistory; }
});
