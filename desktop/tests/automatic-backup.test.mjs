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
  '@/lib/storage': 'export const getStorageEngine=()=>globalThis.backupNative ? "sqlite":"idb";export const loadFullHistory = async () => globalThis.backupHistoryRead ? globalThis.backupHistoryRead() : globalThis.backupHistory;',
  '@/lib/mediaCache': 'export const readMediaCache = async () => null; export const waitForMediaCacheWrites = async () => {};',
  '../store/persist': 'export const flushPersist = async get => { await globalThis.backupFlush?.(get()); };',
};
const built = await build({
  stdin: { contents: `export { runAutomaticBackup, readLatestAutomaticBackup } from './src/lib/automaticBackup.ts';
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

const { runAutomaticBackup, readLatestAutomaticBackup, defaultSettings, parseBackupJson, beginDataRestore } = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text+'\n//# sourceURL=automatic-backup-test.js').toString('base64'));

const stateFixture = () => ({ hydrated: true, phones: [], contacts: [], chats: [], messages: [], followUps: [],
  activities: [], broadcastCampaigns: [], settings: { ...defaultSettings } });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('automatic backup saves deletions before reading disk history and aborts on save failure', async () => {
  const state = stateFixture();
  let disk = [{ id: 'deleted', chatId: 'chat', direction: 'in', body: 'old', sentAt: '2026-10-01T00:00:00Z' }];
  globalThis.backupStatus = { latestDay: null };
  globalThis.backupHistoryRead = async () => ({ messages: disk, activities: [] });
  globalThis.backupFlush = async snapshot => { assert.equal(snapshot, state); disk = []; };
  try {
    await runAutomaticBackup(() => state, true);
    assert.deepEqual(JSON.parse(globalThis.backupContent).messages, []);
    delete globalThis.backupContent;
    globalThis.backupFlush = async () => { throw new Error('save failed'); };
    await assert.rejects(runAutomaticBackup(() => state, true), /save failed/);
    assert.equal(globalThis.backupContent, undefined);
  } finally { delete globalThis.backupFlush; delete globalThis.backupHistoryRead; delete globalThis.backupStatus; }
});

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

test('SQLite automatic backup sends only safe metadata and streams persisted data natively', async()=>{
 const state=stateFixture();state.contacts=[{id:'contact',toJSON(){throw new Error('contacts must not cross backup IPC')}}];state.messages=[{toJSON(){throw new Error('messages must not cross backup IPC')}}];
 state.settings.transcriptionApiKey='speech-secret';
 state.settings.translationApiKey='translation-secret';
 let flushed=false;globalThis.backupFlush=async snapshot=>{assert.equal(snapshot,state);flushed=true};
 const calls=[];globalThis.backupNative=true;globalThis.backupHistoryRead=()=>{throw new Error('must not load all history into the WebView')};
 globalThis.backupInvoke=async(command,args)=>{if(command==='crm_backup_save')assert.equal(flushed,true);calls.push({command,args});return {folder:'fixture',latestDay:null}};
 try{
  await runAutomaticBackup(()=>state,true);
  const saved=calls.find(c=>c.command==='crm_backup_save');assert.equal(saved.args.fromDatabase,true);
  const header=JSON.parse(saved.args.content);for(const key of ['contacts','messages','activities','phones','chats','followUps'])assert.deepEqual(header[key],[]);
  assert.ok(!saved.args.content.includes('speech-secret'));
  assert.ok(!saved.args.content.includes('translation-secret'));
  calls.length=0;globalThis.backupFlush=async()=>{throw new Error('flush failed')};await assert.rejects(runAutomaticBackup(()=>state,true),/flush failed/);assert.ok(!calls.some(c=>c.command==='crm_backup_save'));
 }finally{delete globalThis.backupNative;delete globalThis.backupInvoke;delete globalThis.backupHistoryRead;delete globalThis.backupFlush;}
});

test('segmented automatic backup restores every part under a fixed backup ID and keeps legacy files compatible',async()=>{
 const state=stateFixture(),header={version:2,app:'WAP Plus CRM',...state,settingsSafe:{}};delete header.settings;
 const legacy={...header,contacts:[{id:"legacy",name:"Grace",phone:"+12025550100",stage:"new",tags:[]}]};
 for(const parts of [[legacy],[header,{messages:[{id:'one',chatId:'chat',direction:'in',body:'one',sentAt:'2026-11-01T00:00:00Z'}]},{messages:[{id:'two',chatId:'chat',direction:'in',body:'two',sentAt:'2026-11-01T00:00:01Z'}]},{contacts:[{id:'contact',name:'Grace',phone:'+12025550100',stage:'new',tags:[]}],activities:[]} ]]){
  const reads=[];globalThis.backupInvoke=async(command,args)=>{if(command==='crm_backup_latest_info')return {id:'crm-fixture',parts:parts.length};assert.equal(command,'crm_backup_read_part');assert.equal(args.id,'crm-fixture');reads.push(args.index);return JSON.stringify(parts[args.index]);};
  try{const raw=await readLatestAutomaticBackup(),parsed=parseBackupJson(raw);assert.deepEqual(reads,parts.map((_,i)=>i));assert.equal(parsed.messages.length,parts.length>1?2:0);if(parts.length>1)assert.equal(parsed.contacts[0].name,'Grace');}
  finally{delete globalThis.backupInvoke;}
 }
});

test('damaged or unexpected backup parts fail before any restore can start',async()=>{
 const header={version:2,app:'WAP Plus CRM',phones:[],contacts:[],chats:[],followUps:[],messages:[],activities:[]};
 for(const bad of [{settingsSafe:[]},{messages:'invalid'},null,{},[],{messages:[],contacts:null}]){
  globalThis.backupInvoke=async(command,args)=>command==='crm_backup_latest_info'?{id:'fixed',parts:2}:JSON.stringify(args.index===0?header:bad);
  try{await assert.rejects(readLatestAutomaticBackup(),/分段格式无效/);}finally{delete globalThis.backupInvoke;}
 }
 let reads=0;globalThis.backupInvoke=async(command,args)=>{if(command==='crm_backup_latest_info')return {id:'fixed',parts:3};reads++;if(args.index===1)throw new Error('checksum failed');return JSON.stringify(header)};
 try{await assert.rejects(readLatestAutomaticBackup(),/checksum failed/);assert.equal(reads,2);}finally{delete globalThis.backupInvoke;}
 for(const count of [0,-1,1.5,4097,Infinity]){
  globalThis.backupInvoke=async()=>({id:'fixed',parts:count});try{await assert.rejects(readLatestAutomaticBackup(),/清单无效/);}finally{delete globalThis.backupInvoke;}
 }
});
