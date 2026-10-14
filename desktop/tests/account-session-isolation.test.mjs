import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { createBaileysRequestHandler } from '../baileys-bridge/httpServer.mjs';

// Fictional phone fixtures: NANPA reserves 555-0100–0199, https://www.nanpa.com/numbering/555-line-numbers.

// Fictional phone fixtures: NANPA reserves 555-0100–0199, https://www.nanpa.com/numbering/555-line-numbers.

const mocks = {
  '@/lib/bridge': `export const isTauri = () => true;
    export const bridgeInvoke = (...args) => globalThis.sessionTestInvoke(...args);`,
  '@/lib/syncDebug': `export const syncLog = () => {}; export const isSyncDebugEnabled = () => false;`,
};
const built = await build({
  stdin: { contents: `export * from './src/lib/baileysCore.ts';
    export { baileysRestart, baileysLogout } from './src/lib/baileysChatActions.ts';
    export { resolveAccountIdentity, reconcileAccountLogin } from './src/lib/accountIdentity.ts';
    export { ensureAccounts } from './src/lib/accounts.ts';
    export { applyMessagesSync } from './src/store/messagesIngest.ts';
    export { buildPersonThreadRows } from './src/lib/personThreads.ts';
    export { collapseAllAccountFolderChats } from './src/components/layout/folderChatDisplay.ts';
    export { hideEmptySiblingChats } from './src/lib/chatActivity.ts';
    export { backfillChatPreviewFromMessages } from './src/store/chatReconcile.ts';`,
    resolveDir: fileURLToPath(new URL('../', import.meta.url)) },
  bundle: true, write: false, format: 'esm', platform: 'neutral',
  alias: { '@': fileURLToPath(new URL('../src', import.meta.url)), '@shared': fileURLToPath(new URL('../../shared', import.meta.url)) },
  plugins: [{ name: 'session-io', setup(b) {
    b.onResolve({ filter: /.*/ }, args => mocks[args.path] ? { path: args.path, namespace: 'mock' } : undefined);
    b.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path] }));
  } }],
});
const mod = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const realFetch = globalThis.fetch;
test.after(() => { globalThis.fetch = realFetch; delete globalThis.sessionTestInvoke; });

test('a different login never overwrites history identity, including after logout', () => {
  const old = { phoneE164: '+12025550101', userName: 'B', avatarUrl: 'old-avatar' };
  assert.throws(() => mod.resolveAccountIdentity(old, { connection: 'connected', user: { id: '12025550102:9@s.whatsapp.net' } }), /已阻止混入记录/);
  const reconnect = mod.resolveAccountIdentity(old, { connection: 'reconnecting', user: null });
  assert.equal(reconnect.avatarUrl, old.avatarUrl);
  assert.equal(reconnect.phoneE164, old.phoneE164);
  const qr = mod.resolveAccountIdentity(old, { connection: 'qr', user: null });
  assert.equal(qr.avatarUrl, old.avatarUrl);
  assert.equal(qr.phoneE164, old.phoneE164);
});

test('new and replayed incoming messages preserve the bound number as provenance', () => {
  const bag={contacts:[],chats:[],messages:[],nextSelectedChatId:null,nextSelectedContactId:null};
  const item={id:'proof-id',jid:'12025550103@s.whatsapp.net',phoneE164:'+12025550103',body:'hello',direction:'in',sentAt:'2026-10-13T10:00:00Z'};
  const opts={bag,items:[item],payload:{},deviceId:'wa-proof',accountPhoneE164:'+12025550101',selfName:''};
  mod.applyMessagesSync(opts);
  assert.equal(bag.messages.length,1); assert.equal(bag.messages[0].accountPhoneE164,'+12025550101');
  delete bag.messages[0].accountPhoneE164;
  mod.applyMessagesSync(opts);
  assert.equal(bag.messages.length,1); assert.equal(bag.messages[0].accountPhoneE164,'+12025550101');
});

test('swapping logins moves sessions and labels, while logical history stays with its number', async () => {
  let accounts = mod.ensureAccounts([
    {id:'wa-a',label:'2',sort:1,phoneE164:'+12025550101',avatarUrl:'A'},
    {id:'wa-b',label:'4',sort:3,phoneE164:'+12025550102',avatarUrl:'B'},
  ]);
  const observer = (id,status,phones) => {accounts = mod.reconcileAccountLogin(accounts,id,status,phones);};
  mod.setBaileysSessionResolver(id => {
    const a=accounts.find(a=>a.id===id);
    return {sessionAccountId:a.sessionAccountId || id,phoneE164:a.historyPhoneE164};
  },observer);
  const calls=[];
  globalThis.sessionTestInvoke = async (cmd,args) => {
    calls.push([cmd,args.accountId]);
    return {accountId:args.accountId,token:'test',baseUrl:`http://${args.accountId}`};
  };
  const requests=[];
  globalThis.fetch = async (url,init) => {
    requests.push([url,init.headers]);
    const session=new URL(url).hostname;
    if(url.endsWith('/status')) return Response.json({protocolVersion:4,connection:'connected',accountId:session,
      user:{id:session==='wa-a'?'12025550102:8@s.whatsapp.net':'12025550101:15@s.whatsapp.net'}});
    return Response.json({accountId:session,ok:true,deletionEvents:[{type:'messages.delete',deviceId:session,
      accountId:session,payload:{accountId:session,items:[{id:'deleted-proof'}]}}]});
  };
  try {
    await assert.rejects(mod.baileysStatus('wa-b'), /号码不一致/);
    await assert.rejects(mod.baileysStatus('wa-a'), /号码已切换/);
    const a=accounts.find(a=>a.id==='wa-a'),b=accounts.find(a=>a.id==='wa-b');
    assert.equal(a.historyPhoneE164,'+12025550101'); assert.equal(a.label,'4'); assert.equal(a.avatarUrl,'A');
    assert.equal(b.historyPhoneE164,'+12025550102'); assert.equal(b.label,'2'); assert.equal(b.avatarUrl,'B');
    assert.equal(mod.ensureAccounts(accounts).find(a=>a.id==='wa-a').sessionAccountId,'wa-b');
    const status=await mod.baileysStatus('wa-a'); assert.equal(status.accountId,'wa-a');
    await mod.request('/send',{method:'POST'},'wa-a');
    assert.equal(requests.at(-1)[0],'http://wa-b/send');
    assert.equal(requests.at(-1)[1]['X-Wap-Expected-Phone'],'+12025550101');
    const snapshot=await mod.request('/sync',{method:'POST'},'wa-a');
    assert.equal(snapshot.deletionEvents[0].deviceId,'wa-a');
    assert.equal(snapshot.deletionEvents[0].payload.accountId,'wa-a');
    await mod.baileysResetAccount('wa-a'); assert.deepEqual(calls.at(-1),['baileys_reset_account','wa-b']);
    const fresh=mod.reconcileAccountLogin(accounts,'wa-a',{user:{id:'12025550105@s.whatsapp.net'}},new Map());
    assert.equal(fresh,accounts);
  } finally {mod.setBaileysSessionResolver(id=>({sessionAccountId:id})); mod.resetBaileysRuntimeCache();}
});

test('duplicate logins and partially swapped slots cannot keep swapping ownership', () => {
  const accounts=mod.ensureAccounts([{id:'wa-a',phoneE164:'+12025550101'},{id:'wa-b',phoneE164:'+12025550102'}]);
  const b={connection:'connected',user:{id:'12025550102@s.whatsapp.net'}};
  const bothB=new Map([['wa-a','+12025550102'],['wa-b','+12025550102']]);
  assert.equal(mod.reconcileAccountLogin(accounts,'wa-a',b,bothB),accounts);
  assert.equal(mod.reconcileAccountLogin(accounts,'wa-a',b,new Map()),accounts);
  assert.throws(()=>mod.reconcileAccountLogin([...accounts,{id:'wa-empty'}],'wa-empty',b,bothB),/已有历史账号/);
});

test('changing a session during a read drops the old response', async () => {
  const started=deferred(),response=deferred(); let session='wa-left';
  mod.setBaileysSessionResolver(()=>({sessionAccountId:session,phoneE164:'+12025550101'}));
  globalThis.sessionTestInvoke=async (_cmd,args)=>({accountId:args.accountId,token:'test',baseUrl:'http://localhost'});
  globalThis.fetch=async()=>{started.resolve();return response.promise;};
  try {
    const read=mod.request('/events',undefined,'wa-route-race'); await started.promise;
    session='wa-right'; const rejected=assert.rejects(read,/旧会话响应/);
    response.resolve(Response.json({accountId:'wa-left',events:[]})); await rejected;
  } finally {mod.setBaileysSessionResolver(id=>({sessionAccountId:id}));}
});

const contacts = ['a', 'b', 'c'].map(id => ({ id, phone: '+12025550103', name: 'Client', accountId: `wa-${id}` }));
const chats = contacts.map((c, i) => ({ id: `chat-${c.id}`, contactId: c.id, accountId: c.accountId,
  lastMessage: 'cached preview', unread: i, updatedAt: `2026-10-1${i}T09:00:00Z`, hasMessageHistory: i === 0 }));
test('three cached previews count as one account when only one has real history', () => {
  const rows = mod.collapseAllAccountFolderChats(chats, new Map(contacts.map(c => [c.id, c])));
  assert.equal(rows[0].accountCount, 1);
  assert.equal(rows[0].chat.id, 'chat-a');
  assert.equal(mod.buildPersonThreadRows({ contacts, chats, messages: [], seed: contacts[0] }).length, 1);
  const cold = mod.collapseAllAccountFolderChats([{...chats[0], lastMessage: '', unread: 0}], new Map(contacts.map(c => [c.id, c])));
  assert.equal(cold[0].accountCount, 1);
});
test('empty same-person rows on other accounts are hidden without deleting genuine empty leads', () => {
  const empty = { id: 'chat-empty', contactId: 'empty-contact', accountId: 'wa-b', phoneId: 'wa-b', hasMessageHistory: false, lastMessage: '', unread: 0 };
  const active = { id: 'chat-active', contactId: 'active-contact', accountId: 'wa-a', phoneId: 'wa-a', hasMessageHistory: true, lastMessage: '', unread: 0 };
  const unrelated = { ...empty, id: 'chat-new-lead', contactId: 'new-contact', accountId: 'wa-c', phoneId: 'wa-c' };
  const contactsById = new Map([
    ['empty-contact', { id: 'empty-contact', phone: '+1 202 555 0103', isGroup: false }],
    ['active-contact', { id: 'active-contact', phone: '+12025550103', isGroup: false }],
    ['new-contact', { id: 'new-contact', phone: '+12025550104', isGroup: false }],
  ]);
  assert.deepEqual(mod.hideEmptySiblingChats([empty, active, unrelated], [empty, active, unrelated], contactsById).map(chat => chat.id), ['chat-active', 'chat-new-lead']);
});
test('messages owned by another device, system events and pending sends do not prove activity', () => {
  const messages = [
    { id: 'wrong', chatId: 'chat-b', deviceId: 'wa-a', direction: 'in', body: 'wrong owner' },
    { id: 'pending', chatId: 'chat-b', accountId: 'wa-b', direction: 'out', deliveryStatus: 'pending' },
    { id: 'system', chatId: 'chat-c', accountId: 'wa-c', direction: 'in', systemKind: 'encryption' },
  ].map(m => ({sentAt: '2026-10-13T09:00:00Z', ...m}));
  const rows = mod.buildPersonThreadRows({ contacts, chats, messages, seed: contacts[0] });
  assert.deepEqual(rows.map(r => r.accountId), ['wa-a']);
  const backfilled = mod.backfillChatPreviewFromMessages(chats, messages);
  assert.equal(backfilled.find(c => c.id === 'chat-b').hasMessageHistory, false);
});

test('new QR resets the selected process and never asks the old process to reuse its caches', async () => {
  const calls = [];
  globalThis.sessionTestInvoke = async (cmd, args) => { calls.push([cmd, args]); };
  globalThis.fetch = async () => { throw new Error('old process must not be called'); };
  await mod.baileysRestart(true, 'wa-reset-test');
  assert.deepEqual(calls, [['baileys_reset_account', {accountId: 'wa-reset-test'}]]);
});
test('reads wait for reset, while responses already in flight are discarded', async () => {
  const oldResponse = deferred(), fetchStarted = deferred(), resetting = deferred();
  let fetched = 0, runtime = 0;
  globalThis.sessionTestInvoke = async (cmd, args) => {
    if (cmd === 'baileys_reset_account') return resetting.promise;
    runtime++;
    return {accountId: args.accountId, token: 'test-token', baseUrl: 'http://127.0.0.1:12345'};
  };
  globalThis.fetch = async () => {
    fetched++;
    if (fetched === 1) { fetchStarted.resolve(); return oldResponse.promise; }
    return Response.json({accountId: 'wa-race-test', fresh: true});
  };
  const oldRead = mod.request('/events', undefined, 'wa-race-test');
  await fetchStarted.promise;
  const reset = mod.baileysResetAccount('wa-race-test');
  const newRead = mod.request('/events', undefined, 'wa-race-test');
  await new Promise(r => setImmediate(r));
  assert.equal(fetched, 1);
  assert.equal(runtime, 1);
  const rejected = assert.rejects(oldRead, /旧会话响应/);
  oldResponse.resolve(Response.json({accountId: 'wa-race-test', stale: true}));
  await rejected;
  resetting.resolve(); await reset;
  assert.equal((await newRead).fresh, true);
  assert.equal(runtime, 2);
});
test('a wrong runtime or wrong account response is rejected before it can be imported', async () => {
  globalThis.sessionTestInvoke = async () => ({accountId: 'wa-b', token: 'test', baseUrl: 'http://127.0.0.1:1'});
  globalThis.fetch = async () => { throw new Error('wrong runtime must not be used'); };
  await assert.rejects(mod.request('/events', undefined, 'wa-wrong-runtime'), /后台账号/);
  globalThis.sessionTestInvoke = async (_cmd, args) => ({accountId: args.accountId, token: 'test', baseUrl: 'http://127.0.0.1:1'});
  globalThis.fetch = async () => Response.json({accountId: 'wa-b', events: []});
  await assert.rejects(mod.request('/events', undefined, 'wa-wrong-response'), /其他账号的数据/);
});
test('reset during a send preserves unknown delivery and never replays the send', async () => {
  const response = deferred(), started = deferred();
  let sends = 0;
  globalThis.sessionTestInvoke = async (cmd, args) => cmd === 'baileys_reset_account' ? undefined
    : {accountId: args.accountId, token: 'test', baseUrl: 'http://127.0.0.1:1'};
  globalThis.fetch = async () => { sends++; started.resolve(); return response.promise; };
  const send = mod.request('/send', {method: 'POST'}, 'wa-send-reset');
  await started.promise;
  await mod.baileysResetAccount('wa-send-reset');
  const rejected = assert.rejects(send, error => error.deliveryUncertain === true);
  response.resolve(Response.json({ok: true}));
  await rejected; assert.equal(sends, 1);
});
test('the bridge rejects a request for another account before returning a snapshot', async () => {
  let status, body;
  const handler = createBaileysRequestHandler({token: 'test', accountId: 'wa-a', port: 1,
    snapshot: () => { throw new Error('other account must not be read'); }});
  await handler({method: 'POST', url: '/sync', headers: {'x-wap-token': 'test', 'x-wap-account-id': 'wa-b'}},
    {setHeader() {}, writeHead(value) {status = value;}, end(value) {body = JSON.parse(value);} });
  assert.equal(status, 409); assert.equal(body.error, 'account mismatch');
});

test('the bridge blocks sync and send if the session has the wrong number or no identity', async () => {
  for(const path of ['/sync','/events','/send','/send-media']) for(const user of [null,{id:'12025550102:8@s.whatsapp.net'}]) {
    let status,body;
    const handler=createBaileysRequestHandler({token:'test',accountId:'wa-slot',port:1,
      statusPayload:()=>({user}), snapshot:()=>assert.fail('wrong history must not be read')});
    await handler({method:path==='/events'?'GET':'POST',url:path,headers:{'x-wap-token':'test','x-wap-account-id':'wa-slot','x-wap-expected-phone':'+12025550101'}},
      {setHeader(){},writeHead(v){status=v;},end(v){body=JSON.parse(v);}});
    assert.equal(status,409); assert.match(body.error,/号码不一致/);
  }
});
