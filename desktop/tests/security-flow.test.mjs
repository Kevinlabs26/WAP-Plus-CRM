import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { getSuggestionContextKey } from "../src/lib/aiSuggest.ts";
import { markManualSuggestionContext, isManualSuggestionContext } from "../src/lib/aiSuggestionCache.ts";
globalThis.getFlowContextKey = getSuggestionContextKey;
globalThis.isFlowManualContext = isManualSuggestionContext;
const mocks = {
  "@/store/appStore": "export const useAppStore = { getState: () => globalThis.flowState };",
  "@/lib/utils": "export const resolveSendTarget = () => '12025550100';",
  "@/lib/aiSuggest": `export const getSuggestionContextKey = (...args) => globalThis.getFlowContextKey(...args);
    export const hasRealAiKey = () => true; export const generateSuggestions = (...args) => globalThis.generateFlow(...args);`,
  "@/lib/accountConnection": "export const isWaAccountConnected = () => globalThis.connectedFlow !== false;",
  "@/lib/transcribeVoice": "export const transcribeVoice = (...args) => globalThis.transcribeFlow(...args);",
  "@/components/chat/reloadMediaAction": "export const reloadMedia = (...args) => globalThis.reloadFlow(...args);",
  "@/lib/aiSuggestionCache": "export const isManualSuggestionContext = (...args) => globalThis.isFlowManualContext(...args);",
  "@/components/chat/sendTextMessage": "export const sendTextMessage = async (opts) => { await globalThis.beforeAutoGate?.(); if (opts.canSend && !opts.canSend()) { opts.updateMessageDelivery(opts.msgId, { deliveryStatus: 'failed' }); return; } globalThis.sentFlow.push(opts.text); opts.updateMessageDelivery(opts.msgId, { deliveryStatus: 'sent' }); };",
  "@/lib/desktopNotify": "export const showDesktopNotify = async (opts) => { globalThis.notificationFlow.push(opts); return true; };",
};
const built = await build({
  stdin: { contents: 'export * from "./src/lib/aiAutoReply.ts"; export * from "./src/lib/autoReplyRuntime.ts"; export * from "./src/lib/inboundMessageNotify.ts";', resolveDir: fileURLToPath(new URL("../", import.meta.url)) },
  bundle: true, format: "esm", platform: "browser", write: false,
  plugins: [{ name: "flow-mocks", setup(b) {
    b.onResolve({ filter: /.*/ }, args => mocks[args.path] ? { path: args.path, namespace: "mock" } : undefined);
    b.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ contents: mocks[args.path], loader: "js" }));
  } }], alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) },
});
const { autoReplyInbound, scheduleAutoReplyInbound, stopAutoReplies, useAutoReplyRuntime, notifyInboundMessages } = await import("data:text/javascript;base64," + Buffer.from(built.outputFiles[0].text).toString("base64"));
function setup(chatId) {
  globalThis.sentFlow = [];
  globalThis.beforeAutoGate = undefined;
  globalThis.connectedFlow = true;
  const inbound = { id: chatId + "-in", chatId, contactId: "c", accountId: "wa", body: "Hello", direction: "in", sentAt: new Date().toISOString() };
  globalThis.flowState = {
    settings: { aiReplyMode: "auto", aiAutoReplyManualChatIds: [], aiAutoReplyIntervalMs: 5000, sendChannel: "baileys", liveBaileysAccountId: "wa", activeAccountId: "wa", waAccounts: [] },
    contacts: [{ id: "c", accountId: "wa", name: "Customer", phone: "12025550100" }],
    chats: [{ id: chatId, accountId: "wa", contactId: "c" }], messages: [inbound],
    baileysUi: { connection: "open" }, bridge: { connected: true }, draftReply: "my draft",
    logActivity() {}, pushToast() {}, setDraftReply(text) { this.draftReply = text; },
    enqueueOutgoingMessage(opts) { const id = chatId + "-out"; this.messages.push({ ...opts, id, direction: "out", sentAt: new Date().toISOString() }); this.draftReply = ""; return id; },
    updateMessageDelivery(id, patch) { Object.assign(globalThis.flowState.messages.find(x => x.id === id), patch); },
    patchMessage(id, patch) { Object.assign(globalThis.flowState.messages.find(x => x.id === id), patch); },
  };
  return inbound;
}
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
const reply = { source: "openai", suggestions: [{ text: "Hello there" }] };

function fakeTimers() {
 const original={setTimeout,clearTimeout};let id=0;const timers=new Map();
 globalThis.setTimeout=(callback,delay)=>{const key=++id;timers.set(key,{callback,delay});return key;};globalThis.clearTimeout=key=>timers.delete(key);
 return {timers,async fire(){const [key,timer]=timers.entries().next().value;timers.delete(key);await timer.callback();},close(){stopAutoReplies();Object.assign(globalThis,original);}};
}

test('live short messages debounce and generate only for the newest complete context',async()=>{
 const clock=fakeTimers();try{
  const first=setup('debounce-live');let calls=0;globalThis.generateFlow=async()=>{calls++;return reply;};
  scheduleAutoReplyInbound(first);const second={...first,id:'debounce-second',sentAt:new Date(Date.now()+1).toISOString(),body:'second sentence'};globalThis.flowState.messages.push(second);scheduleAutoReplyInbound(second);
  assert.equal(calls,0);assert.equal(clock.timers.size,1);assert.equal([...clock.timers.values()][0].delay,1200);
  await clock.fire();assert.equal(calls,1);assert.equal(globalThis.sentFlow.length,1);
 }finally{clock.close();}
});

test('new incoming messages abort the old generation and send only a fresh reply',async()=>{
 const first=setup('abort-old');let calls=0,oldSignal;
 globalThis.generateFlow=(_contact,_thread,_settings,opts)=>{if(++calls===1){oldSignal=opts.signal;return new Promise((_,reject)=>opts.signal.addEventListener('abort',()=>reject(new DOMException('Cancelled','AbortError')),{once:true}));}return Promise.resolve(reply);};
 const running=autoReplyInbound(first),second={...first,id:'abort-new',sentAt:new Date(Date.now()+1).toISOString()};globalThis.flowState.messages.push(second);await autoReplyInbound(second);await running;
 assert.equal(oldSignal.aborted,true);assert.equal(calls,2);assert.deepEqual(globalThis.sentFlow,['Hello there']);
});

test('temporary AI failures retry before sending, stop after three retries and respect manual pause',async()=>{
 const clock=fakeTimers();try{
  let calls=0;globalThis.generateFlow=async()=>{calls++;return {source:'mock',fallback:true,retryable:true,error:'network unavailable',suggestions:[]};};
  const inbound=setup('retry-limits');await autoReplyInbound(inbound);assert.equal(clock.timers.size,1);
  for(let i=0;i<3;i++)await clock.fire();assert.equal(calls,4);assert.equal(clock.timers.size,0);assert.deepEqual(globalThis.sentFlow,[]);
  const paused=setup('retry-paused');await autoReplyInbound(paused);globalThis.flowState.settings.aiReplyMode='semi';await clock.fire();assert.equal(clock.timers.size,0);assert.equal(calls,5);
 }finally{clock.close();}
});

test('disconnected accounts recover without resending an existing outgoing message',async()=>{
 const clock=fakeTimers();try{
  const inbound=setup('retry-offline');globalThis.connectedFlow=false;let calls=0;globalThis.generateFlow=async()=>{calls++;return reply;};
  await autoReplyInbound(inbound);assert.equal(calls,0);assert.equal(clock.timers.size,1);
  globalThis.connectedFlow=true;await clock.fire();assert.equal(calls,1);assert.equal(globalThis.sentFlow.length,1);
  assert.equal(clock.timers.size,0);
 }finally{clock.close();}
});

test('recovery expires after sleep and never regenerates for a message already queued',async()=>{
 const clock=fakeTimers(),now=Date.now;try{
  const inbound=setup('retry-sleep');let calls=0;globalThis.generateFlow=async()=>{calls++;return {source:'mock',fallback:true,retryable:true,error:'network',suggestions:[]};};
  await autoReplyInbound(inbound);Date.now=()=>now()+6*60_000;await clock.fire();assert.equal(calls,1);assert.equal(clock.timers.size,0);Date.now=now;
  const waiting=setup('retry-already-queued');await autoReplyInbound(waiting);
  globalThis.flowState.messages.push({...waiting,id:'already-out',direction:'out',systemKind:'ai_auto_reply',deliveryStatus:'queued',sentAt:new Date(now()+1).toISOString()});
  await clock.fire();assert.equal(calls,2);assert.equal(clock.timers.size,0);
 }finally{Date.now=now;clock.close();}
});

test('voice replies download missing media and transcribe before generation; failed recognition never invents a reply',async()=>{
 const clock=fakeTimers();try{
  const inbound=setup('voice-auto');inbound.mediaType='audio';inbound.body='';let transcribed=0;
  globalThis.reloadFlow=async({message})=>{globalThis.flowState.patchMessage(message.id,{mediaUrl:'data:audio/ogg;base64,AA=='});};
  globalThis.flowState.settings.voiceInputLang='zh';
  globalThis.transcribeFlow=async(_url,_mime,_settings,opts)=>{transcribed++;assert.equal(opts.language,'');return {text:'Bonjour, comment allez-vous ?',fallback:false};};
  globalThis.generateFlow=async(_contact,thread)=>{assert.equal(thread[0].transcript,'Bonjour, comment allez-vous ?');return reply;};
  await autoReplyInbound(inbound);assert.equal(transcribed,1);assert.equal(globalThis.sentFlow.length,1);
  const failed=setup('voice-failed');failed.mediaType='audio';failed.mediaUrl='data:audio/ogg;base64,AA==';failed.body='[语音]';
  globalThis.transcribeFlow=async()=>({text:'',fallback:true,error:'未配置语音服务'});globalThis.generateFlow=()=>assert.fail('must not generate for unrecognized voice');
  await autoReplyInbound(failed);assert.deepEqual(globalThis.sentFlow,[]);assert.equal(clock.timers.size,0);
 }finally{clock.close();}
});

test('manual takeover prevents voice upload and model use across multiple incoming messages',async()=>{
 const inbound=setup('voice-manual');inbound.mediaType='audio';inbound.body='[语音]';
 globalThis.flowState.messages.unshift({...inbound,id:'manual-before',mediaType:undefined,direction:'out',systemKind:undefined,body:'Hi',sentAt:new Date(Date.now()-60000).toISOString()});
 globalThis.transcribeFlow=()=>assert.fail('must not transcribe during takeover');globalThis.generateFlow=()=>assert.fail('must not generate during takeover');globalThis.reloadFlow=()=>assert.fail('must not fetch voice during takeover');
 await autoReplyInbound(inbound);assert.deepEqual(globalThis.sentFlow,[]);
});

test('new text does not wait for old voice work, and cancelled voice never overwrites its runtime status',async()=>{
 for(const stage of ['download','transcription']){
  const voice=setup('cancel-voice-'+stage);voice.mediaType='audio';voice.body='[语音]';if(stage==='transcription')voice.mediaUrl='fixture';
  let release,started=false,oldSignal;const work=new Promise(resolve=>{release=resolve;});
  globalThis.reloadFlow=async opts=>{started=true;oldSignal=opts.signal;await work;};
  globalThis.transcribeFlow=async(_url,_mime,_settings,opts)=>{started=true;oldSignal=opts.signal;return work;};
  globalThis.generateFlow=async()=>reply;
  const running=autoReplyInbound(voice);while(!started)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(useAutoReplyRuntime.getState().byChat[voice.chatId].phase,'transcribing');
  const latest={...voice,id:'new-text-'+stage,body:'A new question',mediaType:undefined,mediaUrl:undefined,sentAt:new Date(Date.now()+1).toISOString()};globalThis.flowState.messages.push(latest);
  await autoReplyInbound(latest);await running;
  assert.equal(oldSignal.aborted,true);assert.deepEqual(globalThis.sentFlow,['Hello there']);assert.equal(useAutoReplyRuntime.getState().byChat[voice.chatId],undefined);
  release({text:'Old voice',fallback:false});await new Promise(resolve=>setImmediate(resolve));assert.equal(voice.transcript,undefined);assert.equal(globalThis.sentFlow.length,1);
 }
});

test('runtime exposes generation, retry and permanent failure without retaining an old message status',async()=>{
 const clock=fakeTimers();try{
  const message=setup('runtime-states'),ai=deferred();globalThis.generateFlow=()=>ai.promise;
  const running=autoReplyInbound(message);assert.equal(useAutoReplyRuntime.getState().byChat[message.chatId].phase,'generating');
  ai.resolve({source:'mock',fallback:true,retryable:true,error:'503 unavailable',suggestions:[]});await running;
  const retry=useAutoReplyRuntime.getState().byChat[message.chatId];assert.equal(retry.phase,'retry');assert.ok(retry.retryAt>Date.now());assert.match(retry.reason,/503/);
  globalThis.generateFlow=async()=>({source:'mock',fallback:true,retryable:false,error:'401 invalid key',suggestions:[]});await clock.fire();
  assert.equal(useAutoReplyRuntime.getState().byChat[message.chatId].phase,'human');assert.match(useAutoReplyRuntime.getState().byChat[message.chatId].reason,/401/);
  stopAutoReplies();assert.deepEqual(useAutoReplyRuntime.getState().byChat,{});
 }finally{clock.close();}
});
test("AI completion observes current automation, takeover, provider and newest context", async () => {
  for (const mode of ["disabled", "manual-only", "manual-reply", "new-inbound", "endpoint", "identity", "account-identity", "model", "stage", "manual-ai"]) {
    const inbound = setup(mode);
    const ai = deferred(); globalThis.generateFlow = () => ai.promise;
    const running = autoReplyInbound(inbound);
    const state = globalThis.flowState;
    if (mode === "disabled") state.settings = { ...state.settings, aiReplyMode: "semi" };
    if (mode === "manual-only") state.settings = { ...state.settings, aiAutoReplyManualChatIds: [inbound.chatId] };
    if (mode === "endpoint") state.settings = { ...state.settings, customAiBaseUrl: "https://changed.invalid" };
    if (mode === "identity") state.settings = { ...state.settings, aiSystemPrompt: "Different identity" };
    if (mode === "account-identity") state.settings = { ...state.settings, aiSystemPromptByAccountId: { wa: "Different account identity" } };
    if (mode === "model") state.settings = { ...state.settings, aiModel: "different-model" };
    if (mode === "stage") state.contacts = state.contacts.map(c => ({ ...c, stage: "won" }));
    if (mode === "manual-ai") markManualSuggestionContext(getSuggestionContextKey(state.contacts[0], state.messages, state.settings, "wa"));
    if (mode === "manual-reply" || mode === "new-inbound") state.messages.push({ ...inbound, id: "new", direction: mode === "manual-reply" ? "out" : "in", sentAt: new Date(Date.now() + 1).toISOString() });
    ai.resolve(reply); await running;
    assert.deepEqual(globalThis.sentFlow, [], mode);
  }
});
test("inbound arriving during generation is coalesced and receives the only reply", async () => {
  const inbound = setup("coalesced"); const first = deferred(); const contexts = [];
  globalThis.generateFlow = (_contact, thread) => { contexts.push(thread.map(x => x.id)); return contexts.length === 1 ? first.promise : Promise.resolve(reply); };
  const running = autoReplyInbound(inbound);
  const latest = { ...inbound, id: "latest", body: "How are you?", sentAt: new Date(Date.now() + 1).toISOString() };
  globalThis.flowState.messages.push(latest);
  await autoReplyInbound(latest);
  first.resolve(reply); await running;
  assert.equal(contexts.length, 2);
  assert.ok(contexts[1].includes("latest"));
  assert.deepEqual(globalThis.sentFlow, ["Hello there"]);
  assert.equal(globalThis.flowState.draftReply, "my draft");
});
test("cooldown retains new inbound and rechecks automation when timer fires", async () => {
  const inbound = setup("cooldown"); globalThis.generateFlow = async () => reply;
  await autoReplyInbound(inbound);
  const latest = { ...inbound, id: "cooldown-latest", sentAt: new Date(Date.now() + 1).toISOString() };
  globalThis.flowState.messages.push(latest);
  const original = globalThis.setTimeout; let callback;
  globalThis.setTimeout = (fn, ms) => { assert.ok(ms > 0); callback = fn; return 123; };
  try { await autoReplyInbound(latest); } finally { globalThis.setTimeout = original; }
  assert.equal(typeof callback, "function");
  globalThis.flowState.settings.aiReplyMode = "semi";
  callback(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(globalThis.sentFlow, ["Hello there"]);
});
test("private notifications exclude customer text, names and avatars", () => {
  globalThis.document = { hasFocus: () => false }; globalThis.notificationFlow = [];
  for (const privacy of ["name", "hidden", "full"]) {
    notifyInboundMessages([{ chatId: "chat", messageId: privacy, contactName: "Private Customer", senderName: "Private Sender", body: "secret message", avatarUrl: "private-avatar", isGroup: true }], {
      selectedChatId: null, mutedUntilByChatId: {}, enabled: true, groupMessagesEnabled: true, privacy, openChat() {},
    });
  }
  const [name, hidden, full] = globalThis.notificationFlow;
  assert.equal(name.title, "Private Customer"); assert.equal(name.body.includes("secret"), false); assert.equal(name.body.includes("Private Sender"), false);
  assert.equal(hidden.title.includes("Private"), false); assert.equal(hidden.body.includes("secret"), false); assert.equal(hidden.avatarUrl, undefined);
  assert.equal(full.body, "Private Sender：secret message");
});

test("old manual history outside the context window does not prevent a fresh reply", async () => {
  const inbound = setup("long-history");
  globalThis.flowState.messages.unshift(...Array.from({ length: 20 }, (_, index) => ({ ...inbound, id: "old-" + index, direction: index === 0 ? "out" : "in", sentAt: new Date(Date.now() - 3600000 + index).toISOString() })));
  globalThis.generateFlow = async (_contact, context) => {
    assert.ok(context.length > 14);
    assert.ok(context.some(message => message.id === "old-0"));
    assert.ok(context.every(message => message.chatId === inbound.chatId));
    return reply;
  };
  await autoReplyInbound(inbound);
  assert.deepEqual(globalThis.sentFlow, ["Hello there"]);
});

test("identity and model changes while waiting to dispatch block the old reply; receipt updates do not", async () => {
  for (const kind of ["identity", "model", "stage", "receipt"]) {
    const inbound = setup(`before-gate-${kind}`);
    globalThis.generateFlow = async () => reply;
    globalThis.beforeAutoGate = () => {
      const state = globalThis.flowState;
      if (kind === "identity") state.settings = { ...state.settings, aiSystemPrompt: "New role" };
      if (kind === "model") state.settings = { ...state.settings, customAiModel: "different-model" };
      if (kind === "stage") state.contacts = state.contacts.map(c => ({ ...c, stage: "won" }));
      if (kind === "receipt") state.messages[0].deliveryStatus = "read";
    };
    await autoReplyInbound(inbound);
    assert.deepEqual(globalThis.sentFlow, kind === "receipt" ? ["Hello there"] : [], kind);
  }
});

test("indexed auto-reply context avoids scanning unrelated conversations without removing dispatch safety checks", async () => {
  const inbound = setup("indexed-context"), state = globalThis.flowState;
  state.messagesByChatId = { [inbound.chatId]: [inbound] };
  let scans = 0;
  Object.defineProperty(state.messages, "filter", { value(...args) { scans++; return Array.prototype.filter.apply(this, args); } });
  globalThis.generateFlow = async (_contact, context) => { assert.deepEqual(context, [inbound]); return reply; };
  await autoReplyInbound(inbound);
  assert.equal(scans, 1, "the remaining collection scan is the dispatch safety decision");
  assert.deepEqual(globalThis.sentFlow, ["Hello there"]);
});

test("dispatch rechecks automation after waiting behind an account send", async () => {
  const channels = await build({
    entryPoints: [fileURLToPath(new URL("../src/channels/index.ts", import.meta.url))], bundle: true, format: "esm", platform: "browser", write: false,
    alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) },
    plugins: [{ name: "senders", setup(b) {
      b.onResolve({ filter: /^\.\/(baileys|androidBridge)$/ }, args => ({ path: args.path, namespace: "sender" }));
      b.onLoad({ filter: /.*/, namespace: "sender" }, args => ({ contents: "export const " + (args.path.endsWith("baileys") ? "baileysChannel" : "androidBridgeChannel") + " = { sendText: input => globalThis.gateSend(input) };" }));
    } }],
  });
  const { dispatchSendText } = await import("data:text/javascript;base64," + Buffer.from(channels.outputFiles[0].text).toString("base64"));
  const started = deferred(); const release = deferred(); let sends = 0; let allowed = true;
  globalThis.gateSend = async () => { sends++; started.resolve(); await release.promise; return { ok: true, delivered: true, status: "sent" }; };
  const input = { accountId: "wait-test", phoneE164: "12025550100", text: "hello" };
  const config = { channelId: "baileys", rateLimitEnabled: false, blockSendWhenOverheated: false };
  const first = dispatchSendText(input, config); await started.promise;
  const second = dispatchSendText(input, { ...config, canSend: () => allowed });
  allowed = false; release.resolve();
  const [, cancelled] = await Promise.all([first, second]);
  assert.equal(sends, 1); assert.equal(cancelled.error, "automation_cancelled"); assert.equal(cancelled.status, "failed");
});

test("scoped automation works under a manual default and rechecks changed rules after generation", async () => {
 for (const mode of ["send", "pause", "folder-manual", "chat-manual", "removed"]) {
  const inbound = setup("scoped-" + mode), state = globalThis.flowState;
  Object.assign(state.settings, { aiReplyMode: "semi", chatFolders: [{ id:"f",name:"Customers",chatIds:[inbound.chatId],autoReplyMode:"auto" }] });
  const ai=deferred();globalThis.generateFlow=()=>ai.promise;
  const running=autoReplyInbound(inbound);
  if(mode==="pause")state.settings.aiAutoReplyPaused=true;
  if(mode==="folder-manual")state.settings.chatFolders[0].autoReplyMode="manual";
  if(mode==="chat-manual")state.settings.aiAutoReplyModeByChatId={[inbound.chatId]:"manual"};
  if(mode==="removed")state.settings.chatFolders[0].chatIds=[];
  ai.resolve(reply);await running;
  assert.equal(globalThis.sentFlow.length,mode==="send"?1:0,mode);
 }
});
test("a single conversation override does not enable another conversation",async()=>{
 const inbound=setup("individual"),state=globalThis.flowState;Object.assign(state.settings,{aiReplyMode:"semi",aiAutoReplyModeByChatId:{individual:"auto"}});
 globalThis.generateFlow=async()=>reply;await autoReplyInbound(inbound);assert.equal(globalThis.sentFlow.length,1);
 const other=setup("individual-other");Object.assign(globalThis.flowState.settings,{aiReplyMode:"semi",aiAutoReplyModeByChatId:{individual:"auto"}});
 await autoReplyInbound(other);assert.equal(globalThis.sentFlow.length,0);
});
