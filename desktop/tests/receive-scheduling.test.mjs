import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {needsFullMessageReconcile} from '../src/store/messageReconcilePolicy.ts';
const mocks={
 'react':`export const useRef=current=>({current});export const useEffect=fn=>{globalThis.receiveCleanup=fn();};`,
 '@/store/appStore':`export const useAppStore=f=>f(globalThis.receiveState);useAppStore.getState=()=>globalThis.receiveState;useAppStore.setState=p=>Object.assign(globalThis.receiveState,typeof p==='function'?p(globalThis.receiveState):p);`,
 '@/lib/baileys':`export const baileysSessionEpoch=id=>globalThis.receiveEpochs[id]||0;export const baileysEvents=(cursor,id,ack,realtimeAfter)=>globalThis.receiveEvents(cursor,id,ack,realtimeAfter);export const baileysStatus=id=>globalThis.receiveStatus(id);export const baileysSync=id=>globalThis.receiveSync(id);export const baileysLabels=async()=>({labels:[]});export const baileysFetchAvatar=async()=>null;`,
 '@/store/persist':`export const prunePersistedMessageMemory=()=>{};export const persist=()=>{};export const flushPersist=()=>globalThis.receiveSave();`,
 '@/lib/mediaCache':`export const waitForMediaCacheWrites=async()=>{};`,
 '@/lib/composerActivity':`export const isComposerTypingBusy=()=>Boolean(globalThis.receiveTyping);`,
 '@/lib/groupJoinNotify':`export const notifyGroupJoinRequests=()=>{};`,
 '@/lib/syncDebug':`export const syncLog=()=>{};`,
 '@/i18n':`export const useI18n=()=>({t:k=>k});`,
};
const result=await build({entryPoints:[fileURLToPath(new URL('../src/components/bridge/BaileysWatcher.tsx',import.meta.url))],bundle:true,write:false,format:'esm',platform:'browser',alias:{'@':fileURLToPath(new URL('../src',import.meta.url))},plugins:[{name:'receive-boundaries',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
const {BaileysWatcher}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
const settle=async()=>{for(let i=0;i<50;i++)await Promise.resolve();};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture({typing=false,focused='b',blocked='',accounts=5,onIngest=async()=>{}}={}){
 const original={window:globalThis.window,document:globalThis.document,sessionStorage:globalThis.sessionStorage,navigator:globalThis.navigator,requestAnimationFrame:globalThis.requestAnimationFrame,cancelAnimationFrame:globalThis.cancelAnimationFrame,performance:globalThis.performance},oldNow=Date.now;
 let now=1700000000000,nextTimer=0,active=0,maxActive=0;
 Date.now=()=>now;
 globalThis.performance={now:()=>now};
 const timers=new Map(),handlers=new Map(),cursors=new Map(),calls=[],statusCalls=[],ingested=[],errors=[],notices=[],slow=deferred();
 globalThis.receiveTyping=typing;globalThis.receiveEpochs={};globalThis.receiveSave=async()=>{};globalThis.receiveSync=async()=>({contacts:[],messages:[]});
 const later=(fn,ms,interval=0)=>{const id=++nextTimer;timers.set(id,{fn,at:now+ms,interval});return id;};
 globalThis.window={setTimeout:(f,ms)=>later(f,ms),clearTimeout:id=>timers.delete(id),setInterval:(f,ms)=>later(f,ms,ms),clearInterval:id=>timers.delete(id),addEventListener:(k,fn)=>handlers.set(k,fn),removeEventListener:k=>handlers.delete(k)};
 globalThis.document={hidden:false,addEventListener:(k,fn)=>handlers.set(k,fn),removeEventListener:k=>handlers.delete(k)};
 globalThis.requestAnimationFrame=fn=>later(()=>fn(now),16);globalThis.cancelAnimationFrame=id=>timers.delete(id);
 globalThis.sessionStorage={getItem:k=>cursors.get(k)||null,setItem:(k,v)=>cursors.set(k,v)};
 globalThis.receiveStatus=async id=>{statusCalls.push(id);active++;maxActive=Math.max(active,maxActive);if(id===blocked)await slow.promise;active--;return {connection:'starting'};};
 globalThis.receiveEvents=async(cursor,id)=>{calls.push({id,at:now,cursor});return {cursor:0,events:[]};};
 const ids=Array.from({length:accounts},(_,i)=>String.fromCharCode(97+i));
 globalThis.receiveState={hydrated:true,uiReady:true,activeNav:'chats',settings:{sendChannel:'baileys',activeAccountId:'a',liveBaileysAccountId:'a',waAccounts:ids.map(id=>({id,userName:'Account '+id,status:'connected'}))},selectedChatId:'focused',contacts:[],chats:[{id:'focused',accountId:focused}],messages:[],baileysUi:{},ingestBridgeEvents:async e=>{ingested.push(e);await onIngest(e);},pushToast:(message,tone)=>{if(tone==='error')errors.push(message);},setBaileysUi(){},setBaileysLoginOpen(){},syncWhatsAppLabels(){}};
 const originalToast=globalThis.receiveState.pushToast;
 globalThis.receiveState.pushToast=(message,tone)=>{notices.push({message,tone});originalToast(message,tone);};
 BaileysWatcher();
 return {calls,statusCalls,ingested,cursors,errors,notices,slow,ids,handlers,get maxActive(){return maxActive;},
  async advance(ms){const end=now+ms;let steps=0;while(true){const entry=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!entry)break;if(++steps>10000)throw new Error('timer loop');const [id,timer]=entry;now=timer.at;if(timer.interval)timer.at+=timer.interval;else timers.delete(id);timer.fn();await settle();}now=end;await settle();},
  close(){globalThis.receiveCleanup();Date.now=oldNow;for(const [key,value]of Object.entries(original))if(key!=='navigator')globalThis[key]=value;},
 };
}
test('different sending/viewing accounts keep all five accounts polling, including during continuous typing',async()=>{
 for(const typing of [false,true]){const ui=fixture({typing});try{await ui.advance(20000);for(const id of ui.ids)assert.ok(ui.calls.filter(c=>c.id===id).length>=3,`account ${id}, typing=${typing}`);assert.ok(ui.maxActive<=4);assert.deepEqual(ui.errors,[]);}finally{ui.close();}}
});
test('one blocked account cannot hold other accounts or start duplicate polls of itself',async()=>{
 const ui=fixture({blocked:'c'});try{await ui.advance(20000);for(const id of ['a','b','d','e'])assert.ok(ui.calls.filter(c=>c.id===id).length>=3,id);assert.equal(ui.statusCalls.filter(id=>id==='c').length,1);assert.ok(ui.maxActive<=4);ui.slow.resolve();await settle();assert.equal(ui.calls.filter(c=>c.id==='c').length,1);}finally{ui.close();}
});
test('saved accounts refresh from two to three connected without visiting devices or starting empty slots',async()=>{
 for(const savedIdentity of [{phoneE164:'+15550000003'},{historyPhoneE164:'+15550000003'},{sessionAccountId:'session-c'}]){
  const ui=fixture({focused:'a'});
  const state=globalThis.receiveState;
  state.settings.waAccounts[2]={id:'c',...savedIdentity,status:'disconnected'};
  for(const i of [3,4])state.settings.waAccounts[i]={id:ui.ids[i],status:'disconnected'};
  globalThis.receiveStatus=async()=>({connection:'connected'});
  const connectedCount=()=>state.settings.waAccounts.filter(a=>a.status==='connected').length;
  try{assert.equal(connectedCount(),2);await ui.advance(5000);assert.equal(connectedCount(),3);assert.ok(ui.calls.some(c=>c.id==='c'));assert.ok(ui.calls.every(c=>!['d','e'].includes(c.id)));assert.equal(state.activeNav,'chats');}finally{ui.close();}
 }
});
test('connection status updates before a delayed or failed message request completes',async()=>{
 for(const fail of [false,true]){
  const ui=fixture({accounts:1,focused:'a'}),events=deferred();
  globalThis.receiveState.settings.waAccounts[0].status='connecting';
  globalThis.receiveStatus=async()=>({connection:'connected'});
  globalThis.receiveEvents=()=>fail?Promise.reject(new Error('Events unavailable')):events.promise;
  try{await ui.advance(1600);assert.equal(globalThis.receiveState.settings.waAccounts[0].status,'connected',`events failed=${fail}`);assert.equal(globalThis.receiveState.activeNav,'chats');}finally{events.resolve({cursor:0,events:[]});await settle();ui.close();}
 }
});
test('busy typing still ingests live messages and retains the durable cursor until saving finishes',async()=>{
 const ui=fixture({typing:true,accounts:1,focused:'a'}),saved=deferred();let sent=false;globalThis.receiveSave=()=>saved.promise;
 globalThis.receiveEvents=async(cursor,id)=>{ui.calls.push({id,cursor});if(sent)return {cursor:1,events:[]};sent=true;return {cursor:1,events:[{type:'contacts.sync',deviceId:id,payload:{source:'message',items:[{id:'person'}]}},{type:'messages.sync',deviceId:id,payload:{live:true,items:[{id:'live',body:'Hello'}]}}]};};
 try{await ui.advance(2000);assert.deepEqual(ui.ingested.flat().map(e=>e.type),['contacts.sync','messages.sync']);assert.equal(ui.cursors.size,0);saved.resolve();await settle();assert.equal(ui.cursors.get('wap.baileys.eventCursor.a'),'1');}finally{ui.close();}
});
test('history ahead of a live message keeps FIFO order and drains in small batches while typing',async()=>{
 const ui=fixture({typing:true,accounts:1,focused:'a'});let sent=false;
 globalThis.receiveEvents=async()=>{if(sent)return {cursor:2,events:[]};sent=true;return {cursor:2,events:[{type:'messages.sync',deviceId:'a',payload:{live:false,source:'history',items:Array.from({length:100},(_,i)=>({id:'history-'+i}))}},{type:'messages.sync',deviceId:'a',payload:{live:true,items:[{id:'live'}]}}]};};
 try{await ui.advance(2000);assert.deepEqual(ui.ingested.flat().flatMap(e=>e.payload.items.map(i=>i.id)),[...Array.from({length:100},(_,i)=>'history-'+i),'live']);assert.ok(ui.ingested.every(batch=>batch.flatMap(e=>e.payload.items||[e]).length<=48));assert.deepEqual(ui.errors,[]);}finally{ui.close();}
});
test('history makes bounded progress even when typing never stops',async()=>{
 const ui=fixture({typing:true,accounts:1,focused:'a'});let sent=false;
 globalThis.receiveEvents=async()=>{if(sent)return {cursor:1,events:[]};sent=true;return {cursor:1,events:[{type:'contacts.sync',deviceId:'a',payload:{source:'history',items:Array.from({length:100},(_,i)=>({id:'history-'+i}))}}]};};
 try{await ui.advance(6000);assert.equal(ui.ingested.flat().flatMap(e=>e.payload.items).length,100);}finally{ui.close();}
});
test('forcing refresh respects concurrency, and unmount prevents late responses from entering the store',async()=>{
 const ui=fixture({blocked:'a',accounts:8});try{ui.handlers.get('wap:refresh-account-status')();ui.handlers.get('wap:refresh-account-status')();await settle();assert.ok(ui.maxActive<=4);assert.equal(ui.statusCalls.filter(id=>id==='a').length,1);globalThis.receiveCleanup();ui.slow.resolve();await settle();assert.equal(ui.calls.some(c=>c.id==='a'),false);assert.equal(ui.ingested.length,0);}finally{ui.close();}
});

test('hidden windows ingest live events without relying on animation frames',async()=>{
 const ui=fixture({accounts:1,focused:'a'});let sent=false;
 globalThis.document.hidden=true;globalThis.requestAnimationFrame=()=>{throw new Error('Hidden-window animation frame');};
 globalThis.receiveEvents=async()=>{if(sent)return {cursor:1,events:[]};sent=true;return {cursor:1,events:[{type:'messages.sync',deviceId:'a',payload:{live:true,items:[{id:'hidden-live'}]}}]};};
 try{await ui.advance(2000);assert.equal(ui.ingested.flat().flatMap(e=>e.payload.items)[0].id,'hidden-live');assert.deepEqual(ui.errors,[]);}finally{ui.close();}
});
test('live work has a short idle-callback deadline even when the browser is continuously busy',async()=>{
 const ui=fixture({typing:true,accounts:1,focused:'a'});let sent=false;
 window.requestIdleCallback=(fn,{timeout})=>window.setTimeout(()=>fn({timeRemaining:()=>0,didTimeout:true}),timeout);
 window.cancelIdleCallback=id=>window.clearTimeout(id);
 globalThis.receiveEvents=async()=>{if(sent)return {cursor:2,events:[]};sent=true;return {cursor:2,events:[{type:'messages.sync',deviceId:'a',payload:{live:false,source:'history',items:Array.from({length:1000},(_,i)=>({id:'idle-history-'+i}))}},{type:'messages.sync',deviceId:'a',payload:{live:true,items:[{id:'idle-live'}]}}]};};
 try{await ui.advance(4000);const ids=ui.ingested.flat().flatMap(e=>e.payload.items.map(i=>i.id));assert.equal(ids.length,1001);assert.equal(ids.at(-1),'idle-live');assert.ok(ui.ingested.every(batch=>batch.flatMap(e=>e.payload.items||[e]).length<=48));}finally{ui.close();}
});

test('idle history batches stay coalesced instead of updating the store once per tiny chunk',async()=>{
 const ui=fixture({accounts:1,focused:'a'});let sent=false;
 globalThis.receiveEvents=async()=>{if(sent)return {cursor:1,events:[]};sent=true;return {cursor:1,events:[{type:'contacts.sync',deviceId:'a',payload:{source:'history',items:Array.from({length:400},(_,i)=>({id:'bulk-'+i}))}}]};};
 try{await ui.advance(2000);assert.equal(ui.ingested.flat().flatMap(e=>e.payload.items).length,400);assert.ok(ui.ingested.length<=4);}finally{ui.close();}
});

test('slow checkpoints stay single-flight and save the newest cursor after the first save completes',async()=>{
 const ui=fixture({accounts:1,focused:'a'}),saved=deferred();let saves=0,sequence=0;
 globalThis.receiveSave=()=>{saves++;return saves===1?saved.promise:Promise.resolve();};
 globalThis.receiveEvents=async()=>({cursor:++sequence,events:[{type:'messages.sync',deviceId:'a',payload:{live:true,items:[{id:'live-'+sequence}]}}]});
 try{await ui.advance(6500);assert.equal(saves,1);assert.equal(ui.cursors.size,0);saved.resolve();await settle();await ui.advance(1);assert.equal(saves,2);assert.equal(ui.cursors.get('wap.baileys.eventCursor.a'),String(sequence));}finally{saved.resolve();ui.close();}
});

test('continuous arrivals acknowledge each saved prefix without acknowledging the next pending save',async()=>{
 for(const advanceMs of [1001,4500]){
 const ui=fixture({accounts:1,focused:'a'}),first=deferred(),second=deferred();let saves=0,sequence=0;
 globalThis.receiveSave=()=>++saves===1?first.promise:second.promise;
 globalThis.receiveEvents=async()=>({cursor:++sequence,events:[{type:'messages.sync',deviceId:'a',payload:{live:true,items:[{id:'live-'+sequence}]}}]});
 try{
  await ui.advance(2000);assert.equal(saves,1);assert.equal(sequence,1);
  await ui.advance(advanceMs);assert.ok(sequence>1);assert.equal(ui.cursors.size,0);
  first.resolve();await settle();
  assert.equal(ui.cursors.get('wap.baileys.eventCursor.a'),'1','new arrivals must not invalidate an already saved prefix');
  await ui.advance(100);assert.equal(saves,2);
  assert.equal(ui.cursors.get('wap.baileys.eventCursor.a'),'1','the newer prefix is still saving');
  second.resolve();await settle();assert.equal(ui.cursors.get('wap.baileys.eventCursor.a'),String(sequence));
 }finally{first.resolve();second.resolve();await settle();ui.close();}
 }
});

test('a busy account queue does not hold another account cursor after its own saved prefix',async()=>{
 const ingest=deferred(),aEvents=deferred();let aSent=false,bSent=false;
 const ui=fixture({accounts:2,focused:'a',onIngest:async events=>{
  if(events.some(event=>event.deviceId==='b')){
   aEvents.resolve({cursor:1,events:[{seq:1,type:'messages.sync',deviceId:'a',payload:{live:true,items:[{id:'a-live'}]}}]});
   await ingest.promise;
  }
 }});
 const state=globalThis.receiveState;state.settings.liveBaileysAccountId='b';state.settings.activeAccountId='b';
 globalThis.receiveEvents=async(_cursor,id)=>{
  if(id==='a')return aSent?{cursor:1,events:[]}:(aSent=true,aEvents.promise);
  return bSent?{cursor:1,events:[]}:(bSent=true,{cursor:1,events:[{seq:1,type:'messages.sync',deviceId:'b',payload:{live:true,items:[{id:'b-live'}]}}]});
 };
 try{
  await ui.advance(1800);assert.equal(ui.cursors.size,0);
  await ui.advance(100);assert.equal(ui.cursors.size,0);
  ingest.resolve();await settle();
  assert.equal(ui.cursors.get('wap.baileys.eventCursor.b'),'1','account b is saved even while account a has queued work');
  assert.equal(ui.cursors.has('wap.baileys.eventCursor.a'),false,'account a is not acknowledged before its own queued work is saved');
 }finally{ingest.resolve();aEvents.resolve({cursor:1,events:[]});await settle();ui.close();}
});

test('a busy account acknowledges completed sequences without waiting for its remaining history',async()=>{
 const waiting=deferred();let sent=false;
 const ui=fixture({accounts:1,focused:'a',typing:true,onIngest:async events=>{
  if(events.some(event=>event.seq===2))await waiting.promise;
 }});
 globalThis.receiveEvents=async()=>sent?{cursor:2,events:[]}:(sent=true,{cursor:2,events:[
  {seq:1,type:'messages.sync',deviceId:'a',payload:{live:true,items:Array.from({length:48},(_,i)=>({id:'first-'+i}))}},
  {seq:2,type:'messages.sync',deviceId:'a',payload:{live:true,items:Array.from({length:100},(_,i)=>({id:'remaining-'+i}))}},
 ]});
 try{
  await ui.advance(2000);
  assert.equal(ui.cursors.get('wap.baileys.eventCursor.a'),'1','completed prefix must be checkpointed while sequence 2 is still processing');
  waiting.resolve();await settle();await ui.advance(2000);
  assert.equal(ui.cursors.get('wap.baileys.eventCursor.a'),'2');
 }finally{waiting.resolve();await settle();ui.close();}
});

test('fresh live delivery overtakes old history without acknowledging that unfinished history',async()=>{
 const ui=fixture({accounts:1,focused:'a',typing:true});let sent=false;
 const polls=[];
 globalThis.receiveEvents=async(_cursor,_id,ack,realtimeAfter)=>{
  polls.push({ack,realtimeAfter});
  if(sent)return {cursor:100,events:[],realtimeEvents:[],realtimeCursor:900};
  sent=true;
  return {cursor:100,events:[{seq:100,type:'messages.sync',deviceId:'a',payload:{live:false,source:'history',items:Array.from({length:1000},(_,i)=>({id:'old-'+i}))}}],
   realtimeCursor:900,realtimeEvents:[{seq:900,type:'messages.sync',deviceId:'a',payload:{live:true,source:'notify',items:[{id:'fresh'}]}}]};
 };
 try{
  await ui.advance(2000);
  assert.equal(ui.ingested[0][0].payload.items[0].id,'fresh');
  assert.ok(ui.ingested.flat().flatMap(e=>e.payload.items).length<1001);
  assert.ok(Number(ui.cursors.get('wap.baileys.eventCursor.a')||0)<100,'the fast event must not acknowledge history or its own higher sequence');
  await ui.advance(35000);
  assert.equal(ui.ingested.flat().flatMap(e=>e.payload.items).length,1001);
  assert.equal(ui.cursors.get('wap.baileys.eventCursor.a'),'100');
  assert.ok(polls.some(p=>p.realtimeAfter===900));
 }finally{ui.close();}
});

test('startup recent messages reach the store before old history without advancing its checkpoint',async()=>{
 const ui=fixture({accounts:1,focused:'a',typing:true});let sent=false;
 globalThis.receiveEvents=async()=>sent?{cursor:100,events:[],realtimeCursor:900}:(sent=true,{
  cursor:100,events:[{seq:100,type:'contacts.sync',deviceId:'a',payload:{items:Array.from({length:1000},(_,i)=>({id:'old-'+i}))}}],
  realtimeCursor:900,recentEvents:[{seq:900,type:'messages.sync',deviceId:'a',payload:{live:false,source:'startup-catchup',syncBatchFinal:false,items:[{id:'latest-before-restart'}]}}],
 });
 try{
  await ui.advance(2000);
  assert.equal(ui.ingested[0][0].payload.items[0].id,'latest-before-restart');
  assert.equal(ui.ingested[0][0].payload.live,false);
  assert.ok(Number(ui.cursors.get('wap.baileys.eventCursor.a')||0)<100);
 }finally{ui.close();}
});

test('a session reset during saving cannot acknowledge the old session',async()=>{
 const ui=fixture({accounts:1,focused:'a'}),saved=deferred();let sent=false;
 globalThis.receiveSave=()=>saved.promise;
 globalThis.receiveEvents=async()=>sent?{cursor:1,events:[]}:(sent=true,{cursor:1,events:[{type:'messages.sync',deviceId:'a',payload:{live:true,items:[{id:'old'}]}}]});
 try{await ui.advance(2000);globalThis.receiveEpochs.a=1;saved.resolve();await settle();assert.equal(ui.cursors.size,0);}finally{saved.resolve();ui.close();}
});

test('failed checkpoints retry without waiting for another message and do not replay displayed events',async()=>{
 const ui=fixture({accounts:1,focused:'a'});let saves=0,sent=false;
 globalThis.receiveSave=async()=>{if(++saves===1)throw new Error('temporary save failure');};
 globalThis.receiveEvents=async()=>{if(sent)return {cursor:1,events:[]};sent=true;return {cursor:1,events:[{type:'messages.sync',deviceId:'a',payload:{live:true,items:[{id:'once'}]}}]};};
 try{await ui.advance(2000);assert.equal(saves,1);assert.equal(ui.cursors.size,0);await ui.advance(16000);assert.equal(saves,2);assert.equal(ui.cursors.get('wap.baileys.eventCursor.a'),'1');assert.equal(ui.ingested.flat().flatMap(e=>e.payload.items).length,1);}finally{ui.close();}
});

test('slow productive background polls keep receiving while slow empty polls still back off',async()=>{
 for(const productive of [false,true]){
  const ui=fixture({accounts:2,focused:'a'});
  globalThis.receiveEvents=async(cursor,id)=>{
   ui.calls.push({id,at:Date.now(),cursor});
   if(id==='b')await new Promise(resolve=>window.setTimeout(resolve,5000));
   return {cursor:1,events:id==='b'&&productive?[{type:'messages.sync',deviceId:id,payload:{live:true,items:[{id:'new'}]}}]:[]};
  };
  try{await ui.advance(12000);const count=ui.calls.filter(c=>c.id==='b').length;assert.equal(count,productive?2:1);assert.ok(ui.calls.filter(c=>c.id==='a').length>=4);}finally{ui.close();}
 }
});

test('an hour of healthy quiet polling does not repeatedly reimport history and still receives new messages',async()=>{
 const ui=fixture({accounts:1,focused:'a'});let syncs=0,sendLive=false;
 globalThis.receiveStatus=async()=>({connection:'connected'});
 globalThis.receiveSync=async()=>{syncs++;return {contacts:[],messages:[]};};
 globalThis.receiveEvents=async()=>({cursor:sendLive?1:0,events:sendLive?[{type:'messages.sync',deviceId:'a',payload:{live:true,items:[{id:'after-an-hour'}]}}]:[]});
 try{
  await ui.advance(3_600_000);assert.equal(syncs,1,'healthy silence is not a reason to rebuild all chat history');
  sendLive=true;await ui.advance(2100);
  assert.ok(ui.ingested.flat().some(e=>e.payload.items?.some(i=>i.id==='after-an-hour')));
  assert.deepEqual(ui.errors,[]);
 }finally{ui.close();}
});

test('slicing preserves upstream completion flags and repairs multi-chunk history only once',async()=>{
 const ui=fixture({accounts:1,focused:'a'});let sent=false;
 globalThis.receiveEvents=async()=>{if(sent)return {cursor:1,events:[]};sent=true;return {cursor:1,events:Array.from({length:10},(_,index)=>({type:'messages.sync',deviceId:'a',payload:{live:false,source:'history',historyChunk:{index,total:10},items:Array.from({length:80},(_,i)=>({id:`${index}-${i}`}))}}))};};
 try{await ui.advance(5000);assert.equal(ui.ingested.flat().flatMap(e=>e.payload.items).length,800);assert.equal(ui.ingested.filter(needsFullMessageReconcile).length,1);}finally{ui.close();}
 const incomplete=fixture({accounts:1,focused:'a'});sent=false;
 globalThis.receiveEvents=async()=>{if(sent)return {cursor:1,events:[]};sent=true;return {cursor:1,events:[{type:'messages.sync',deviceId:'a',payload:{live:false,source:'snapshot',syncBatchFinal:false,items:Array.from({length:80},(_,i)=>({id:`incomplete-${i}`}))}}]};};
 try{await incomplete.advance(2000);assert.equal(incomplete.ingested.flat().flatMap(e=>e.payload.items).length,80);assert.equal(incomplete.ingested.filter(needsFullMessageReconcile).length,0);}finally{incomplete.close();}
});

test('failed initial snapshots retry with backoff and event gaps still trigger recovery',async()=>{
 const ui=fixture({accounts:1,focused:'a'});let syncs=0,gap=false;
 globalThis.receiveStatus=async()=>({connection:'connected'});
 globalThis.receiveSync=async()=>{if(++syncs===1)throw new Error('temporary sync failure');return {contacts:[],messages:[]};};
 globalThis.receiveEvents=async()=>{const result={cursor:0,events:[],...(gap?{gap:{count:1}}:{})};gap=false;return result;};
 try{
  await ui.advance(290_000);assert.equal(syncs,1);
  await ui.advance(20_000);assert.equal(syncs,2);
  await ui.advance(600_000);assert.equal(syncs,2);
  gap=true;await ui.advance(5000);assert.equal(syncs,3,'recover overflow even after a successful snapshot');
 }finally{ui.close();}
});

test('history completion is shown only after its database checkpoint succeeds',async()=>{
 const ui=fixture({accounts:1,focused:'a'}),saved=deferred(),notices=ui.notices;let sent=false;
 globalThis.receiveSave=()=>saved.promise;
 globalThis.receiveEvents=async()=>{if(sent)return {cursor:2,events:[]};sent=true;return {cursor:2,events:[{seq:1,type:'messages.sync',deviceId:'a',payload:{live:false,source:'history',items:[{id:'history'}]}},{seq:2,type:'history.sync_status',deviceId:'a',payload:{status:'complete'}}]};};
 try{await ui.advance(2000);assert.equal(notices.filter(n=>n.message==='runtime.historySyncComplete').length,0);saved.resolve();await settle();assert.equal(notices.filter(n=>n.message==='runtime.historySyncComplete').length,1);}finally{saved.resolve();ui.close();}
});
