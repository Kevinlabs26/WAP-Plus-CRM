import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const built=await build({stdin:{contents:`export * from './src/channels/sendGate.ts';export {clearRateLimitState} from './src/channels/rateLimit.ts';`,resolveDir:fileURLToPath(new URL('../',import.meta.url))},bundle:true,write:false,format:'esm',platform:'node',alias:{'@':fileURLToPath(new URL('../src',import.meta.url))}});
const {withSendGate,setSendGateConfigProvider,clearRateLimitState,resolveEffectiveLimits,waitForPendingSends}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text+'\n//# sourceURL=scheduled-gate-test-bundle.js').toString('base64'));
let config;
const storageRows=new Map();globalThis.localStorage={getItem:k=>storageRows.get(k)||null,setItem:(k,v)=>storageRows.set(k,v),removeItem:k=>storageRows.delete(k)};
function setup(){clearRateLimitState();config={rateLimitEnabled:false,blockSendWhenOverheated:false,globalMinGapSec:0,rateJitterSec:0,rateLimits:{perPhonePerMinute:100,perPhonePerHour:1000,minIntervalSec:0}};setSendGateConfigProvider(()=>config);}

test('batch gap cannot be disabled by ordinary manual-send settings',async()=>{
 setup();let sends=0;const input={accountId:'a',phoneE164:'+12025550123'};
 assert.equal((await withSendGate(input,{},async()=>{sends++;return {ok:true};},20)).ok,true);
 const second=await withSendGate({...input,phoneE164:'+12025550124'},{rateLimitEnabled:false},async()=>{sends++;return {ok:true};},20);
 assert.equal(second.ok,false);assert.equal(second.gate.error,'rate_limited');assert.equal(sends,1);
});

test('batch messages from different accounts cannot overlap and long requests still cool down after completion',async()=>{
 setup();const original=Date.now;let now=Date.parse('2026-10-31T10:00:00Z');Date.now=()=>now;
 let release,entered,calls=0;const ready=new Promise(r=>entered=r),wait=new Promise(r=>release=r);
 try{
 const first=withSendGate({accountId:'a',phoneE164:'+12025550123'},{},async()=>{calls++;entered();await wait;return {ok:true};},20);
 await ready;now+=5*60_000;
 const second=withSendGate({accountId:'b',phoneE164:'+12025550124'},{},async()=>{calls++;return {ok:true};},20);
 await Promise.resolve();assert.equal(calls,1);release();await first;
 const result=await second;assert.equal(result.ok,false);assert.equal(result.gate.error,'rate_limited');assert.equal(calls,1);
 now+=22000;assert.equal((await withSendGate({accountId:'b',phoneE164:'+12025550124'},{},async()=>({ok:true}),20)).ok,true);
 }finally{Date.now=original;}
});

test('a queued batch rechecks account pause immediately before transport',async()=>{
 setup();let release,entered;const ready=new Promise(r=>entered=r),wait=new Promise(r=>release=r);
 const first=withSendGate({accountId:'a',phoneE164:'+12025550123'},{},async()=>{entered();await wait;return {ok:true};},20);
 await ready;let sent=false;
 const second=withSendGate({accountId:'b',phoneE164:'+12025550124'},{},async()=>{sent=true;return {ok:true};},20);
 config={...config,sendPausedAccountIds:['b']};release();await first;
 const result=await second;assert.equal(result.ok,false);assert.equal(result.gate.error,'send_paused');assert.equal(sent,false);
});

test('the first batch observes its own gap after a manual send on another account',async()=>{
 setup();const original=Date.now;let now=Date.parse('2026-10-31T10:00:00Z');Date.now=()=>now;
 try{
 assert.equal((await withSendGate({accountId:'manual'},{},async()=>({ok:true}))).ok,true);
 now+=5000;let sent=false;
 const result=await withSendGate({accountId:'batch'},{},async()=>{sent=true;return {ok:true};},30);
 assert.equal(result.ok,false);assert.equal(result.gate.error,'rate_limited');assert.equal(sent,false);
 assert.ok(result.gate.retryAfterMs>=25000);
 now+=26000;assert.equal((await withSendGate({accountId:'batch'},{},async()=>({ok:true}),30)).ok,true);
 }finally{Date.now=original;}
});

test('a stricter second plan cannot inherit the preceding shorter interval',async()=>{
 setup();const original=Date.now;let now=Date.parse('2026-10-31T10:00:00Z');Date.now=()=>now;
 try{
 await withSendGate({accountId:'a'},{},async()=>({ok:true}),20);
 now+=22000;
 assert.equal((await withSendGate({accountId:'b'},{},async()=>{throw Error('must not send');},60)).ok,false);
 now+=40000;assert.equal((await withSendGate({accountId:'b'},{},async()=>({ok:true}),60)).ok,true);
 }finally{Date.now=original;}
});

test('invalid limits fall back to bounded defaults and batch intervals have a mandatory floor',async()=>{
 setup();assert.deepEqual(resolveEffectiveLimits({rateLimits:{perPhonePerMinute:NaN,perPhonePerHour:Infinity,minIntervalSec:undefined}}).limits,
 {perPhonePerMinute:8,perPhonePerHour:80,minIntervalSec:4});
 assert.deepEqual(resolveEffectiveLimits({rateLimits:{perPhonePerMinute:1,perPhonePerHour:1,minIntervalSec:0},waAccounts:[{id:'new',createdAt:new Date().toISOString()}]},'new').limits,
 {perPhonePerMinute:1,perPhonePerHour:1,minIntervalSec:3});
 config={...config,globalMinGapSec:NaN,rateLimits:{perPhonePerMinute:NaN,perPhonePerHour:Infinity,minIntervalSec:NaN}};
 assert.equal((await withSendGate({accountId:'a'},{},async()=>({ok:true}),NaN)).ok,true);
 const second=await withSendGate({accountId:'b'},{},async()=>{throw Error('must not send');},0);
 assert.equal(second.ok,false);assert.equal(second.gate.error,'rate_limited');assert.ok(second.gate.retryAfterMs>=19000);
});

test('a failed batch transport still persists its cooldown immediately and releases the queue',async()=>{
 setup();const original=globalThis.localStorage;const rows=new Map();
 globalThis.localStorage={getItem:k=>rows.get(k)||null,setItem:(k,v)=>rows.set(k,v),removeItem:k=>rows.delete(k)};
 try{
 await assert.rejects(withSendGate({accountId:'a'},{},async()=>{throw Error('lost response');},30),/lost response/);
 const saved=JSON.parse(rows.get('bridgecrm.rateLimit.v1'));
 assert.ok(saved.globalNextAllowedAt>=Date.now()+29000);
 const result=await withSendGate({accountId:'b'},{},async()=>{throw Error('must not send');},30);
 assert.equal(result.ok,false);assert.equal(result.gate.error,'rate_limited');
 }finally{clearRateLimitState();globalThis.localStorage=original;}
});

test('minute and hour budgets apply to combined manual and batch sends and survive a restart',async()=>{
 setup();const realNow=Date.now,originalStorage=globalThis.localStorage;
 let now=Date.parse('2026-10-31T10:00:00Z');Date.now=()=>now;
 const rows=new Map();globalThis.localStorage={getItem:k=>rows.get(k)||null,setItem:(k,v)=>rows.set(k,v),removeItem:k=>rows.delete(k)};
 config={...config,rateLimits:{perPhonePerMinute:2,perPhonePerHour:3,minIntervalSec:0}};
 const input={accountId:'quota-account'};let sends=0;const send=async()=>{sends++;return {ok:true};};
 try{
 await withSendGate(input,{},send);now+=22000;
 assert.equal((await withSendGate(input,{},send,20)).ok,true);now+=22000;
 assert.equal((await withSendGate(input,{},send,20)).ok,false);assert.equal(sends,2);
 now+=22000;assert.equal((await withSendGate(input,{},send,20)).ok,true);
 const saved=JSON.parse(rows.get('bridgecrm.rateLimit.v1'));assert.equal(saved.keys['acct::quota-account'].stamps.length,3);
 const restarted=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text+'\n//# sourceURL=scheduled-gate-restart-test.js').toString('base64'));
 let result=await restarted.withSendGate(input,config,send,20);assert.equal(result.ok,false);assert.equal(sends,3);
 now+=61000;result=await restarted.withSendGate(input,config,send,20);
 assert.equal(result.ok,false);assert.match(result.gate.reason,/每小时/);assert.equal(sends,3);
 }finally{clearRateLimitState();globalThis.localStorage=originalStorage;Date.now=realNow;}
});

test('draining sends includes a batch still waiting outside its account queue',async()=>{
 setup();const realNow=Date.now;let now=Date.parse('2026-10-31T10:00:00Z');Date.now=()=>now;
 let releaseFirst,releaseSecond,enterFirst,enterSecond;
 const firstReady=new Promise(r=>enterFirst=r),secondReady=new Promise(r=>enterSecond=r);
 const firstWait=new Promise(r=>releaseFirst=r),secondWait=new Promise(r=>releaseSecond=r);
 const first=withSendGate({accountId:'a'},{},async()=>{enterFirst();await firstWait;return {ok:true};},20);
 // Let the second batch become eligible after the first completes, without a real wait.
 first.then(()=>{now+=60000;});
 await firstReady;
 const second=withSendGate({accountId:'b'},{},async()=>{enterSecond();await secondWait;return {ok:true};},20);
 let drained=false;const draining=waitForPendingSends().then(()=>{drained=true;});
 try{
 releaseFirst();await secondReady;await new Promise(setImmediate);
 assert.equal(drained,false);releaseSecond();await second;await draining;assert.equal(drained,true);
 }finally{releaseFirst();releaseSecond();await Promise.all([first,second,draining]);Date.now=realNow;}
});

test('batch transport is blocked when protection storage cannot be written, and can recover after explicit retry',async()=>{
 setup();const storage=globalThis.localStorage;let sends=0;
 try{
 globalThis.localStorage={...storage,setItem(){throw Error('quota exceeded');}};
 const result=await withSendGate({accountId:'disk-failed'},{},async()=>{sends++;return {ok:true};},20);
 assert.equal(result.ok,false);assert.equal(result.gate.error,'send_paused');assert.equal(sends,0);
 globalThis.localStorage=storage;clearRateLimitState();
 assert.equal((await withSendGate({accountId:'disk-failed'},{},async()=>{sends++;return {ok:true};},20)).ok,true);assert.equal(sends,1);
 }finally{globalThis.localStorage=storage;clearRateLimitState();}
});

test('losing protection storage after transmission marks the result uncertain and releases the queue',async()=>{
 setup();const storage=globalThis.localStorage;
 try{
 await assert.rejects(withSendGate({accountId:'disk-failed'},{},async()=>{globalThis.localStorage={...storage,setItem(){throw Error('disk unavailable');}};return {ok:true};},20),e=>e.deliveryUncertain===true);
 await waitForPendingSends();globalThis.localStorage=storage;clearRateLimitState();
 assert.equal((await withSendGate({accountId:'disk-failed'},{},async()=>({ok:true}),20)).ok,true);
 }finally{globalThis.localStorage=storage;clearRateLimitState();}
});
