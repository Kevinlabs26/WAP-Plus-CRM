import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const mocks={
 'react':`export const useRef=current=>({current});export const useEffect=fn=>{globalThis.receiveCleanup=fn();};`,
 '@/store/appStore':`export const useAppStore=f=>f(globalThis.receiveState);useAppStore.getState=()=>globalThis.receiveState;useAppStore.setState=p=>Object.assign(globalThis.receiveState,typeof p==='function'?p(globalThis.receiveState):p);`,
 '@/lib/baileys':`export const baileysSessionEpoch=id=>globalThis.receiveEpochs[id]||0;export const baileysEvents=(cursor,id)=>globalThis.receiveEvents(cursor,id);export const baileysStatus=id=>globalThis.receiveStatus(id);export const baileysSync=async()=>({contacts:[],messages:[]});export const baileysLabels=async()=>({labels:[]});export const baileysFetchAvatar=async()=>null;`,
 '@/store/persist':`export const persist=()=>{};export const flushPersist=()=>globalThis.receiveSave();`,
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
function fixture({typing=false,focused='b',blocked='',accounts=5}={}){
 const original={window:globalThis.window,document:globalThis.document,sessionStorage:globalThis.sessionStorage,navigator:globalThis.navigator,requestAnimationFrame:globalThis.requestAnimationFrame,cancelAnimationFrame:globalThis.cancelAnimationFrame},oldNow=Date.now;
 let now=1700000000000,nextTimer=0,active=0,maxActive=0;
 Date.now=()=>now;
 const timers=new Map(),handlers=new Map(),cursors=new Map(),calls=[],statusCalls=[],ingested=[],errors=[],slow=deferred();
 globalThis.receiveTyping=typing;globalThis.receiveEpochs={};globalThis.receiveSave=async()=>{};
 const later=(fn,ms,interval=0)=>{const id=++nextTimer;timers.set(id,{fn,at:now+ms,interval});return id;};
 globalThis.window={setTimeout:(f,ms)=>later(f,ms),clearTimeout:id=>timers.delete(id),setInterval:(f,ms)=>later(f,ms,ms),clearInterval:id=>timers.delete(id),addEventListener:(k,fn)=>handlers.set(k,fn),removeEventListener:k=>handlers.delete(k)};
 globalThis.document={hidden:false,addEventListener:(k,fn)=>handlers.set(k,fn),removeEventListener:k=>handlers.delete(k)};
 globalThis.requestAnimationFrame=fn=>later(()=>fn(now),16);globalThis.cancelAnimationFrame=id=>timers.delete(id);
 globalThis.sessionStorage={getItem:k=>cursors.get(k)||null,setItem:(k,v)=>cursors.set(k,v)};
 globalThis.receiveStatus=async id=>{statusCalls.push(id);active++;maxActive=Math.max(active,maxActive);if(id===blocked)await slow.promise;active--;return {connection:'starting'};};
 globalThis.receiveEvents=async(cursor,id)=>{calls.push({id,at:now,cursor});return {cursor:0,events:[]};};
 const ids=Array.from({length:accounts},(_,i)=>String.fromCharCode(97+i));
 globalThis.receiveState={hydrated:true,uiReady:true,activeNav:'chats',settings:{sendChannel:'baileys',activeAccountId:'a',liveBaileysAccountId:'a',waAccounts:ids.map(id=>({id,userName:'Account '+id,status:'connected'}))},selectedChatId:'focused',contacts:[],chats:[{id:'focused',accountId:focused}],messages:[],baileysUi:{},ingestBridgeEvents:async e=>ingested.push(e),pushToast:(message,tone)=>{if(tone==='error')errors.push(message);},setBaileysUi(){},setBaileysLoginOpen(){},syncWhatsAppLabels(){}};
 BaileysWatcher();
 return {calls,statusCalls,ingested,cursors,errors,slow,ids,handlers,get maxActive(){return maxActive;},
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
 globalThis.receiveEvents=async()=>{if(sent)return {cursor:2,events:[]};sent=true;return {cursor:2,events:[{type:'messages.sync',deviceId:'a',payload:{live:false,source:'history',items:Array.from({length:100},(_,i)=>({id:'idle-history-'+i}))}},{type:'messages.sync',deviceId:'a',payload:{live:true,items:[{id:'idle-live'}]}}]};};
 try{await ui.advance(4000);const ids=ui.ingested.flat().flatMap(e=>e.payload.items.map(i=>i.id));assert.equal(ids.length,101);assert.equal(ids.at(-1),'idle-live');}finally{ui.close();}
});

test('idle history batches stay coalesced instead of updating the store once per tiny chunk',async()=>{
 const ui=fixture({accounts:1,focused:'a'});let sent=false;
 globalThis.receiveEvents=async()=>{if(sent)return {cursor:1,events:[]};sent=true;return {cursor:1,events:[{type:'contacts.sync',deviceId:'a',payload:{source:'history',items:Array.from({length:400},(_,i)=>({id:'bulk-'+i}))}}]};};
 try{await ui.advance(2000);assert.equal(ui.ingested.flat().flatMap(e=>e.payload.items).length,400);assert.ok(ui.ingested.length<=4);}finally{ui.close();}
});
