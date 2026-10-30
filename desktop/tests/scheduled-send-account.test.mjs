import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { getSuggestionContextKey } from "../src/lib/aiSuggest.ts";

const result = await build({
  stdin: { contents: 'export * from "./src/components/bridge/ScheduledMessageWatcher.tsx"; export * from "./src/components/bridge/SendQueueWatcher.tsx";', resolveDir: fileURLToPath(new URL("../", import.meta.url)) },
  bundle: true, format: "esm", platform: "browser", write: false,
  alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) },
  plugins: [{ name: "watcher-boundaries", setup(b) {
    b.onResolve({ filter: /^(react|@\/store\/appStore|@\/channels)$/ }, (a) => ({ path: a.path, namespace: "mock" }));
    b.onLoad({ filter: /.*/, namespace: "mock" }, (a) => ({ contents:
      a.path === "react" ? "export const useRef = (current) => ({current}); export const useEffect = (effect) => { globalThis.__watcherCleanup = effect(); }; export const useCallback = (fn) => fn;" :
      a.path === "@/store/appStore" ? "export const useAppStore = {getState: () => globalThis.__watcherState};" :
      'export const normalizeChannelId = (id) => id; export const dispatchSendText = async (request, runtime) => { await globalThis.__beforeDispatch?.(); if (runtime?.canSend && !runtime.canSend()) return {ok:false,error:"automation_cancelled"}; globalThis.__sentRequests.push(request); await globalThis.__waitSend?.(request); return {ok:true}; };'
    }));
  } }],
});
const { ScheduledMessageWatcher, SendQueueWatcher } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);

function setup(accountId = "wa-a") {
  globalThis.window = { setInterval() {}, clearInterval() {} };
  globalThis.__sentRequests = [];
  globalThis.__waitSend = undefined;
  globalThis.__beforeDispatch = undefined;
  const task = { id: "task", status: "pending", accountId, dueAt: new Date(Date.now() - 1000).toISOString(), chatId: "chat", contactId: "c", text: "Hello", recipient: "+12025550100", channelId: "baileys" };
  const state = {
    settings: { scheduledMessages: [task], waAccounts: [{ id: "wa-b", status: "connected" }], liveBaileysAccountId: "wa-b", sendChannel: "baileys" },
    chats: [{ id: "chat", accountId: "wa-a" }], contacts: [{ id: "c", accountId: "wa-a" }],
    messages: [], baileysUi: { connection: "connected" }, pushToast() {},
    updateScheduledMessage(id, patch) { Object.assign(task, patch); },
    enqueueOutgoingMessage(input) { this.messages.push({ ...input, direction: "out", id: "out", sentAt: new Date().toISOString() }); return "out"; },
    listRetryableOutgoing() { return this.messages; },
    updateMessageDelivery(id, patch) { Object.assign(this.messages.find((m) => m.id === id), patch); },
  };
  globalThis.__watcherState = state;
  return state;
}

test("due task whose account was removed never switches to the online account", () => {
  const state = setup();
  ScheduledMessageWatcher();
  assert.equal(state.messages.length, 0);
  assert.equal(state.settings.scheduledMessages[0].status, "failed");
});

test("legacy task without an account fails instead of adopting the current account", () => {
  const state = setup("");
  ScheduledMessageWatcher();
  assert.equal(state.messages.length, 0);
  assert.equal(state.settings.scheduledMessages[0].status, "failed");
});

test("offline original account stays bound and waits even when another is online", async () => {
  const state = setup();
  state.settings.waAccounts.push({ id: "wa-a", status: "disconnected" });
  ScheduledMessageWatcher();
  SendQueueWatcher();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.messages[0].accountId, "wa-a");
  assert.equal(state.messages[0].deliveryStatus, "queued");
  assert.deepEqual(globalThis.__sentRequests, []);
});

test("deleting an account after enqueue also blocks dispatch", async () => {
  const state = setup();
  state.settings.waAccounts.push({ id: "wa-a", status: "connected" });
  ScheduledMessageWatcher();
  state.settings.waAccounts = state.settings.waAccounts.filter((a) => a.id !== "wa-a");
  SendQueueWatcher();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.messages[0].deliveryStatus, "failed");
  assert.deepEqual(globalThis.__sentRequests, []);
});

test("valid task reaches dispatch with its original account", async () => {
  const state = setup("wa-b");
  ScheduledMessageWatcher();
  SendQueueWatcher();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(globalThis.__sentRequests.length, 1);
  assert.equal(globalThis.__sentRequests[0].accountId, "wa-b");
  assert.equal(state.messages[0].deliveryStatus, "sent");
  assert.equal(state.messages[0].systemKind, "scheduled_message");
});

test('overdue tasks require confirmation before enqueue or after waiting offline',async()=>{
 for(const stage of ['pending','queued','dispatch']){
  const state=setup('wa-b'),task=state.settings.scheduledMessages[0];
  const expire=()=>{task.dueAt=new Date(Date.now()-16*60_000).toISOString();};
  if(stage==='pending')expire();
  ScheduledMessageWatcher();
  if(stage==='queued')expire();
  if(stage==='dispatch')globalThis.__beforeDispatch=expire;
  SendQueueWatcher();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(task.status,'expired',stage);assert.deepEqual(globalThis.__sentRequests,[],stage);
  assert.equal(state.messages.length,stage==='pending'?0:1);
  if(state.messages[0])assert.equal(state.messages[0].deliveryStatus,'failed');
 }
});

test("cancelling or deleting a later item invalidates the queue's captured batch", async () => {
  for (const action of ["cancel", "delete", "postpone"]) {
    const state = setup("wa-b");
    ScheduledMessageWatcher();
    state.messages.push({ ...state.messages[0], id: "second", body: "second" });
    let release;
    globalThis.__waitSend = () => new Promise((resolve) => { release = resolve; });
    SendQueueWatcher();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(globalThis.__sentRequests.length, 1);
    state.messages = state.messages.flatMap((m) => m.id !== "second" ? [m] :
      action === "delete" ? [] : [{ ...m,
        deliveryStatus: action === "cancel" ? "failed" : "queued",
        nextAttemptAt: action === "postpone" ? new Date(Date.now() + 60000).toISOString() : undefined,
      }]);
    release();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(globalThis.__sentRequests.length, 1, action);
  }
});

test('a blocked sending account cannot hide another account behind its queued messages',async()=>{
 const state=setup('wa-b');state.settings.waAccounts.push({id:'wa-a',status:'connected'});
 state.messages=['first','second','third','other'].map((id,i)=>({id,body:id,accountId:i===3?'wa-b':'wa-a',phoneE164:'+12025550100',direction:'out',deliveryStatus:'queued',sentAt:String(i)}));
 let release;const blocked=new Promise(resolve=>{release=resolve;});
 globalThis.__waitSend=request=>request.accountId==='wa-a'?blocked:undefined;
 SendQueueWatcher();await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(globalThis.__sentRequests.map(r=>r.text),['first','other']);
 assert.equal(state.messages[3].deliveryStatus,'sent');
 release();await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(globalThis.__sentRequests.filter(r=>r.accountId==='wa-a').map(r=>r.text),['first','second','third']);
});

test('queued retries limit concurrent accounts and media placeholders cannot starve later text',async()=>{
 const state=setup('wa-b');state.settings.waAccounts=['a','b','c','d'].map(id=>({id,status:'connected'}));state.settings.liveBaileysAccountId='a';
 state.messages=[{id:'media',body:'[image]',mediaType:'image',accountId:'a',phoneE164:'+12025550100',direction:'out',deliveryStatus:'queued',sentAt:'0'},...['a','b','c','d'].map((id,i)=>({id,body:id,accountId:id,phoneE164:'+12025550100',direction:'out',deliveryStatus:'queued',sentAt:String(i+1)}))];
 const releases={};const blocked=Object.fromEntries(['a','b','c'].map(id=>[id,new Promise(resolve=>{releases[id]=resolve;})]));
 globalThis.__waitSend=request=>blocked[request.accountId];
 SendQueueWatcher();await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(globalThis.__sentRequests.map(r=>r.accountId),['a','b','c']);
 releases.a();await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(globalThis.__sentRequests.map(r=>r.accountId),['a','b','c','d']);
 releases.b();releases.c();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(globalThis.__sentRequests.some(r=>r.text==='[image]'),false);
});

function queuedAi() {
 const state=setup('wa-b');state.chats[0].accountId='wa-b';state.contacts[0].accountId='wa-b';
 Object.assign(state.settings,{aiReplyMode:'auto',aiAutoReplyManualChatIds:[],aiProvider:'custom',customAiBaseUrl:'https://example.invalid/v1',customAiModel:'model',customAiKey:'fake'});
 const inbound={id:'in',chatId:'chat',contactId:'c',accountId:'wa-b',body:'Hello',direction:'in',sentAt:new Date(Date.now()-2000).toISOString()};
 const key=getSuggestionContextKey(state.contacts[0],[inbound],state.settings,'wa-b',{auto:true});
 const reply={id:'reply',chatId:'chat',contactId:'c',accountId:'wa-b',body:'Hello there',direction:'out',sentAt:new Date(Date.now()-1000).toISOString(),phoneE164:'+12025550100',channelId:'baileys',systemKind:'ai_auto_reply',deliveryStatus:'queued',aiReplyContextHash:createHash('sha256').update(key).digest('hex')};
 state.messages=[inbound,reply];return {state,reply};
}
async function waitForAiQueue(reply) {
 const deadline=Date.now()+2000;
 while(['queued','pending'].includes(reply.deliveryStatus)&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,1));
}

test('queued AI replies preserve matching context and block changed model, identity, account, channel or missing generation metadata',async()=>{
 for(const kind of ['unchanged','model','identity','stage','account','channel','legacy','paused','chat-manual','folder-manual','scoped-auto']){
  const {state,reply}=queuedAi();
  if(kind==='paused')state.settings.aiAutoReplyPaused=true;
  if(kind==='chat-manual')state.settings.aiAutoReplyModeByChatId={chat:'manual'};
  if(kind==='folder-manual')state.settings.chatFolders=[{id:'f',name:'F',chatIds:['chat'],autoReplyMode:'manual'}];
  if(kind==='scoped-auto'){state.settings.aiReplyMode='semi';state.settings.aiAutoReplyModeByChatId={chat:'auto'};}
  if(kind==='model')state.settings.customAiModel='other';
  if(kind==='identity')state.settings.aiSystemPromptByAccountId={'wa-b':'Different identity'};
  if(kind==='stage')state.contacts[0].stage='won';
  if(kind==='account')state.chats[0].accountId='wa-a';
  if(kind==='channel')state.settings.sendChannel='android_bridge';
  if(kind==='legacy')delete reply.aiReplyContextHash;
  SendQueueWatcher();await waitForAiQueue(reply);
  assert.equal(globalThis.__sentRequests.length,['unchanged','scoped-auto'].includes(kind)?1:0,kind);
  assert.equal(reply.deliveryStatus,['unchanged','scoped-auto'].includes(kind)?'sent':'failed',kind);
 }
});

test('queued AI dispatch rechecks configuration after waiting in the send gate',async()=>{
 const {state,reply}=queuedAi();
 globalThis.__beforeDispatch=()=>{state.settings={...state.settings,customAiModel:'changed-while-waiting'};};
 SendQueueWatcher();await waitForAiQueue(reply);
 assert.deepEqual(globalThis.__sentRequests,[]);assert.equal(reply.deliveryStatus,'failed');
});

test('AI hash verification cannot revive a cancelled, deleted or postponed queued reply',async t=>{
 const original=crypto.subtle.digest.bind(crypto.subtle);
 for(const kind of ['cancel','delete','postpone','unmount']){
  const {state,reply}=queuedAi();let release,finish;
  const gate=new Promise(resolve=>{release=resolve;}),done=new Promise(resolve=>{finish=resolve;});
  const mock=t.mock.method(crypto.subtle,'digest',async(...args)=>{await gate;const result=await original(...args);finish();return result;});
  SendQueueWatcher();
  if(kind==='cancel')state.updateMessageDelivery(reply.id,{deliveryStatus:'failed',nextAttemptAt:undefined});
  if(kind==='delete')state.messages=state.messages.filter(m=>m.id!==reply.id);
  if(kind==='postpone')state.updateMessageDelivery(reply.id,{nextAttemptAt:new Date(Date.now()+60000).toISOString()});
  if(kind==='unmount')globalThis.__watcherCleanup();
  release();await done;await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(globalThis.__sentRequests,[],kind);
  assert.notEqual(reply.deliveryStatus,'pending',kind);mock.mock.restore();
 }
});

test('unavailable digest verification stops an AI retry without sending or entering an endless retry loop',async t=>{
 const {reply}=queuedAi();t.mock.method(crypto.subtle,'digest',async()=>{throw new Error('digest unavailable');});
 SendQueueWatcher();await waitForAiQueue(reply);
 assert.deepEqual(globalThis.__sentRequests,[]);assert.equal(reply.deliveryStatus,'failed');
 assert.equal(reply.nextAttemptAt,undefined);assert.equal(reply.retryCount,5);
});

test('queued scoped replies stop when their folder is disabled in the send gate',async()=>{
 const {state,reply}=queuedAi();state.settings.aiReplyMode='semi';state.settings.chatFolders=[{id:'f',name:'F',chatIds:['chat'],autoReplyMode:'auto'}];
 globalThis.__beforeDispatch=()=>{state.settings.chatFolders[0].autoReplyMode='manual';};
 SendQueueWatcher();await waitForAiQueue(reply);assert.deepEqual(globalThis.__sentRequests,[]);assert.equal(reply.deliveryStatus,'failed');
});
