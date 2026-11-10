import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import vm from 'node:vm';
import {createEventSpool} from '../baileys-bridge/eventSpool.mjs';

const source=readFileSync(new URL('../baileys-bridge/index.mjs',import.meta.url),'utf8');
const transportCode=source.slice(source.indexOf('function pauseForStorage()'),source.indexOf('async function getCachedGroupMetadata'));
const connectCode=source.slice(source.indexOf('async function connect(opts'),source.indexOf('async function connectInternal(opts'));
function transport(){
 const calls=[];
 const socket={ev:{removeAllListeners(){calls.push('detach');}},ws:{close(){calls.push('close');}},async end(){calls.push('end');}};
 const context=vm.createContext({socket,authMe:{id:'fixture-account'},connectGeneration:1,reconnectTimer:undefined,connection:'connected',qrDataUrl:'',lastError:'',connectPromise:null,
  clearTimeout,connectInternal:async()=>{calls.push('connect');}});
 vm.runInContext(transportCode+'\n'+connectCode,context);
 return{context,calls};
}

test('transient connection setup failures keep retrying with bounded backoff and stop after recovery', async () => {
 const timers = new Map(), delays = []; let timerId = 0, attempts = 0;
 const context = vm.createContext({
  eventSpool: {health: {receivingPaused: false}}, connection: 'error', reconnectAttempts: 0,
  reconnectTimer: undefined, connectPromise: null,
  setTimeout(callback, delay) { delays.push(delay); timers.set(++timerId, callback); return timerId; },
  clearTimeout(id) { timers.delete(id); },
  async connectInternal(opts) { assert.equal(opts.clearAuth, false); if (++attempts < 4) throw Error('temporary network failure'); },
 });
 vm.runInContext(source.slice(source.indexOf('function scheduleReconnect()'), source.indexOf('async function connectInternal(opts')), context);
 await assert.rejects(() => context.connect({clearAuth: false}));
 for (let i = 0; i < 3; i++) {
  assert.equal(timers.size, 1);
  const [id, callback] = timers.entries().next().value; timers.delete(id); callback();
  for (let tick = 0; tick < 12; tick++) await Promise.resolve();
 }
 assert.equal(attempts, 4); assert.equal(timers.size, 0);
 assert.ok(delays[1] > delays[0] && delays[2] > delays[1]);
 context.reconnectAttempts = 100; context.scheduleReconnect(); assert.equal(delays.at(-1), 45_000);
 context.eventSpool.health.receivingPaused = true; context.scheduleReconnect(); assert.equal(timers.size, 0);
 context.eventSpool.health.receivingPaused = false; context.connection = 'logged_out';
 context.scheduleReconnect(); assert.equal(timers.size, 0);
});

test('disk failures close the receive transport once and reconnection waits for durable recovery',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'wap-storage-protect-')),key=randomBytes(32),{context,calls}=transport();
 const blocked=join(dir,'0000000000000001-0000000000000001.pack.tmp');
 let spool;
 try{
  spool=await createEventSpool(dir,key,{retryMs:100_000,onPause:()=>context.pauseForStorage()});context.eventSpool=spool;
  mkdirSync(blocked);spool.record({seq:1,type:'messages.sync',payload:{body:'retained'}});
  await assert.rejects(()=>spool.flush());
  assert.deepEqual(calls,['detach','close','end']);assert.equal(context.socket,undefined);assert.equal(context.authMe.id,'fixture-account');
  assert.equal(context.connection,'error');assert.match(context.lastError,/暂停接收/);assert.equal(context.connectGeneration,2);
  await assert.rejects(()=>context.connect({clearAuth:true}));assert.equal(calls.includes('connect'),false);
  rmSync(blocked,{recursive:true,force:true});await context.connect({clearAuth:false});
  assert.equal(calls.filter(call=>call==='connect').length,1);assert.equal(spool.health.receivingPaused,false);
  assert.equal((await spool.read(0))[0].payload.body,'retained');
 }finally{if(spool)await spool.flush();rmSync(dir,{recursive:true,force:true});}
});

test('a history burst pauses further reception at the memory threshold without dropping its accepted events',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'wap-storage-pressure-')),key=randomBytes(32),{context,calls}=transport();
 let spool;
 try{
  spool=await createEventSpool(dir,key,{onPause:()=>context.pauseForStorage()});context.eventSpool=spool;
  const body='x'.repeat(512*1024);let accepted=0;
  while(context.socket&&accepted<1000)spool.record({seq:++accepted,type:'messages.sync',payload:{body}});
  assert.ok(accepted>0&&accepted<100);assert.equal(calls.filter(call=>call==='close').length,1);assert.equal(spool.health.receivingPaused,true);
  await spool.recover();const rows=await spool.read(0,[],1000);
  assert.equal(rows.length,accepted);assert.equal(rows.at(-1).seq,accepted);assert.equal(spool.health.receivingPaused,false);
 }finally{if(spool)await spool.flush();rmSync(dir,{recursive:true,force:true});}
});
