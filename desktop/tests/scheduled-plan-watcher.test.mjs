import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const mocks={
 react:'export const useEffect=f=>{globalThis.planWatcherCleanup=f();};',
 '@/store/appStore':'export const useAppStore={getState:()=>globalThis.watcherState};export const flushPersist=async()=>{};',
 '@/lib/scheduledPlanRunner':'export const createScheduledPlanRunner=deps=>{globalThis.watcherDeps=deps;return {tick:async()=>{},stop(){}};};',
 '@/lib/scheduledPlanActions':'export const updateScheduledPlan=async()=>{};',
 '@/channels':'export const sendRuntimeFromSettings=s=>s;export const withSendGate=async(input,config,send,gap)=>{globalThis.watcherGates.push({input,gap});return {ok:true,result:await send()};};',
 '@/lib/baileysSend':'export const baileysSend=(...args)=>globalThis.watcherTransport("text",args);export const baileysSendImage=(...args)=>globalThis.watcherTransport("image",args);export const baileysSendDocument=(...args)=>globalThis.watcherTransport("document",args);export const baileysSendVoice=(...args)=>globalThis.watcherTransport("audio",args);export const baileysSendVideo=(...args)=>globalThis.watcherTransport("video",args);',
 '@/i18n':'export const translateCurrent=k=>k;',
};
const built=await build({entryPoints:[fileURLToPath(new URL('../src/components/bridge/ScheduledPlanWatcher.tsx',import.meta.url))],bundle:true,write:false,format:'esm',platform:'browser',alias:{'@':fileURLToPath(new URL('../src',import.meta.url))},plugins:[{name:'watcher-io',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
const {ScheduledPlanWatcher}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text+'\n//# sourceURL=scheduled-watcher-test-bundle.js').toString('base64'));
const {isRetryableOutgoing}=await import('../src/store/outgoingRetry.ts');
const target={id:'chat',chatId:'chat',contactId:'contact',contactName:'Group',recipient:'12345@g.us',accountId:'owner',status:'pending'};
function setup(){
 const oldWindow=globalThis.window;globalThis.window={setInterval:()=>1,clearInterval(){}};
 const calls=[];globalThis.watcherGates=[];globalThis.watcherTransport=async(kind,args)=>{calls.push([kind,args]);return {ok:true,id:'remote-id'};};
 const state={hydrated:true,uiReady:true,chats:[{id:'chat',contactId:'contact',accountId:'owner'}],contacts:[{id:'contact',name:'Group',isGroup:true,channelAddress:'12345@g.us',accountId:'owner'}],messages:[],settings:{waAccounts:[{id:'owner',status:'connected'},{id:'other',status:'connected'}],activeAccountId:'other',liveBaileysAccountId:'other',chatFolders:[],chatFolderClones:[]},baileysUi:{connection:'connected'},
 enqueueOutgoingMessage(input){const id='message-'+state.messages.length;state.messages.push({...input,id,direction:'out'});return id;},patchMessage(id,patch){Object.assign(state.messages.find(m=>m.id===id),patch);},updateMessageDelivery(id,patch){Object.assign(state.messages.find(m=>m.id===id),patch);}};
 globalThis.watcherState=state;ScheduledPlanWatcher();return {state,calls,deps:globalThis.watcherDeps,cleanup(){globalThis.planWatcherCleanup();globalThis.window=oldWindow;}};
}

for(const kind of ['text','image','audio','video','file'])test(`scheduled ${kind} uses its frozen owner and the mandatory shared send gate`,async()=>{
 const h=setup();try{
 const media=kind==='text'?undefined:{kind,dataUrl:'data:image/png;base64,AA==',size:1,fileName:'frozen.bin',mimeType:'application/octet-stream'};
 const p={gapSec:45,text:'Frozen caption',media};const id=h.deps.enqueue(p,target);
 const result=await h.deps.send(p,{...target,messageId:id},()=>true);h.deps.finish(id,result);
 assert.equal(result.ok,true);assert.equal(h.calls.length,1);assert.equal(h.calls[0][0],kind==='text'?'text':kind==='image'?'image':'document');
 const args=h.calls[0][1];assert.equal(args[0],'12345@g.us');assert.equal(args.at(-1).accountId,'owner');
 assert.equal(globalThis.watcherGates[0].gap,45);assert.equal(globalThis.watcherGates[0].input.accountId,'owner');
 assert.equal(h.state.messages[0].systemKind,'scheduled_plan');assert.equal(h.state.messages[0].deliveryStatus,'sent');
 assert.equal(h.state.messages[0].waMessageId,'remote-id');
 assert.equal(h.deps.enqueue(p,{...target,messageId:id}),id);assert.equal(h.state.messages.length,1,'rate-limit retry reuses the outgoing record');
 assert.equal(isRetryableOutgoing({...h.state.messages[0],deliveryStatus:'queued'}),false,'ordinary queue cannot double-send plan items');
 }finally{h.cleanup();}
});

test('cancellation after waiting for the gate prevents transport, and uncertain sends cannot auto-retry',async()=>{
 const h=setup();try{
 const p={gapSec:30,text:'Body'};const id=h.deps.enqueue(p,target);
 assert.equal((await h.deps.send(p,target,()=>false)).ok,false);assert.equal(h.calls.length,0);
 globalThis.watcherTransport=async()=>{throw Error('request timeout');};
 const result=await h.deps.send(p,target,()=>true);assert.equal(result.uncertain,true);h.deps.finish(id,result);
 assert.equal(h.state.messages[0].deliveryUncertain,true);
 h.state.contacts[0].accountId='other';assert.equal(h.deps.availability(target),'missing');
 }finally{h.cleanup();}
});

for(const kind of ['audio','video'])test(`native ${kind} uses the correct route and step-specific content`,async()=>{
 const h=setup();try{
 const p={gapSec:30,text:'intro',nativeMedia:true,steps:[{text:'',gapSec:50,media:{kind,mimeType:kind==='video'?'video/mp4':'audio/mpeg',fileName:'clip',dataUrl:`data:${kind==='video'?'video/mp4':'audio/mpeg'};base64,AA==`,size:1}}]};
 const current={...target,stepIndex:1};const id=h.deps.enqueue(p,current);const result=await h.deps.send(p,{...current,messageId:id},()=>true);
 assert.equal(result.ok,true);assert.equal(h.calls[0][0],kind);assert.equal(h.state.messages[0].mediaType,kind);assert.equal(globalThis.watcherGates[0].gap,50);
 if(kind==='audio')assert.equal(h.calls[0][1].at(-1).ptt,false);else {assert.equal(h.calls[0][1][3],'owner');assert.equal(typeof h.calls[0][1][4],'function');}
 }finally{h.cleanup();}
});

test('unsupported native video is a definite preflight failure rather than an unknown delivery',async()=>{
 const h=setup();try{
 const p={gapSec:30,text:'caption',nativeMedia:true,media:{kind:'video',mimeType:'video/mp4',fileName:'clip.mp4',dataUrl:'data:video/mp4;base64,AA==',size:1}};
 const id=h.deps.enqueue(p,target);
 globalThis.watcherTransport=async()=>{throw Object.assign(Error('unsupported bridge'),{code:'native_video_unsupported',deliveryUncertain:false});};
 const result=await h.deps.send(p,{...target,messageId:id},()=>true);h.deps.finish(id,result);
 assert.equal(result.ok,false);assert.equal(result.uncertain,false);assert.equal(result.error,'native_video_unsupported');assert.equal(result.message,'planQueue.videoUnsupported');
 assert.equal(h.state.messages[0].deliveryStatus,'failed');assert.equal(h.state.messages[0].deliveryUncertain,false);
 }finally{h.cleanup();}
});
