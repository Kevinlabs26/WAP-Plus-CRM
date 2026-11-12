import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readdirSync, rmSync, readFileSync, writeFileSync, renameSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createEventSpool} from '../baileys-bridge/eventSpool.mjs';
import {createBaileysRequestHandler} from '../baileys-bridge/httpServer.mjs';

test('200000 history messages survive encrypted batch writes, ring overflow, restart and checkpoints',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'wap-events-'));
 const key=randomBytes(32);
 try {
  let spool=await createEventSpool(dir,key);const recent=[];
  for(let seq=1;seq<=2500;seq++){
   const event={seq,type:'messages.sync',payload:{items:Array.from({length:80},(_,i)=>({id:String((seq-1)*80+i)}))}};
   spool.record(event);recent.push(event);if(recent.length>2000)recent.shift();
  }
  await spool.flush();assert.ok(readdirSync(dir).length<50,'history bursts must share batch writes');
  spool=await createEventSpool(dir,key);let after=0;const ids=new Set();
  while(true){const batch=await spool.read(after,recent);if(!batch.length)break;
   assert.ok(batch.length<=40);for(const e of batch)for(const row of e.payload.items)ids.add(row.id);
   after=batch.at(-1).seq;
  }
  assert.equal(ids.size,200000);assert.ok(ids.has('0'));
  assert.equal((await spool.read(0)).length,40,'fetching events is not a durable acknowledgement');
  await spool.acknowledge(1200);spool=await createEventSpool(dir,key);
  assert.equal((await spool.read(0))[0].seq,1201);
  await spool.acknowledge(2500);assert.deepEqual(await spool.read(0),[]);
  assert.deepEqual(readdirSync(dir),['checkpoint.json']);
  spool=await createEventSpool(dir,key);assert.equal(spool.sequence,2500);
  spool.record({seq:2501,type:'messages.sync',payload:{items:[]}});
  assert.equal((await spool.read(2500))[0].seq,2501);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('HTTP event pages are replayable until an explicit saved checkpoint and reject invalid cursors',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'wap-events-http-'));
 try{
  const key=randomBytes(32),spool=await createEventSpool(dir,key);
  for(let seq=1;seq<=95;seq++)spool.record({seq,type:'messages.sync',payload:{items:[]}});
  const handler=createBaileysRequestHandler({token:'test',port:0,accountId:'a',sequence:95,events:[],eventSpool:spool,statusPayload:()=>({protocolVersion:1})});
  const get=async(query)=>{
   let status,body;
   await handler({method:'GET',url:'/events?'+query,headers:{'x-wap-token':'test'}},{setHeader(){},writeHead(code){status=code;},end(data){body=JSON.parse(data);}});
   return {status,body};
  };
  let response=await get('after=0');assert.equal(response.status,200);assert.equal(response.body.cursor,40);
  assert.equal((await spool.read(0))[0].seq,1);
  response=await get('after=0&limit=60');assert.equal(response.body.cursor,60);
  response=await get('after=40&ack=40');assert.equal(response.body.cursor,80);assert.equal((await spool.read(0))[0].seq,41);
  response=await get('after=80&ack=80');assert.equal(response.body.cursor,95);
  await get('after=95&ack=95');assert.deepEqual(await (await createEventSpool(dir,key)).read(0),[]);
  assert.equal((await get('after=-1')).status,400);assert.equal((await get('after=0&ack=NaN')).status,400);
  assert.equal((await get('after=0&limit=20')).status,400);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('blocked history sync schedules a retry without dropping the backlog',async()=>{
 let deferred=0,body,status;
 const handler=createBaileysRequestHandler({
  token:'test',port:0,accountId:'a',sequence:0,events:[],deletionEvents:[],
  eventSpool:{health:{blocked:true,writeError:'',receivingPaused:false,warning:'同步缓存积压'},
   acknowledge:async()=>{},read:async()=>[]},
  deferFullHistorySync:()=>{deferred++;},requestFullHistorySync:async()=>({requested:true}),
  snapshot:()=>({contacts:[],messages:[]}),statusPayload:()=>({protocolVersion:1,connection:'connected'})
 });
 await handler({method:'POST',url:'/sync?requestHistory=1',headers:{'x-wap-token':'test'}},
  {setHeader(){},writeHead(code){status=code;},end(data){body=JSON.parse(data);}});
 assert.equal(status,200);assert.equal(deferred,1);assert.equal(body.historyRequest.deferred,true);
});

test('fresh events are previewed ahead of backlog without skipping or pruning ordered events',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'wap-events-realtime-'));
 try{
  const spool=await createEventSpool(dir,randomBytes(32));
  for(let seq=1;seq<=95;seq++)spool.record({seq,type:'contacts.sync',payload:{items:[]}});
  const recent=[{seq:96,ts:Date.now(),type:'messages.sync',payload:{live:false,items:[]}},
   {seq:97,ts:Date.now(),type:'messages.sync',payload:{live:true,items:[{id:'fresh'}]}},
   {seq:98,ts:Date.now()-120000,type:'messages.sync',payload:{live:true,items:[]}}];
  for(const event of recent)spool.record(event);
  const handler=createBaileysRequestHandler({token:'test',port:0,sequence:98,events:recent,eventSpool:spool,statusPayload:()=>({protocolVersion:1})});
  const get=async query=>{let body,status;await handler({method:'GET',url:'/events?'+query,headers:{'x-wap-token':'test'}},{setHeader(){},writeHead(code){status=code;},end(data){body=JSON.parse(data);}});return {body,status};};
  const first=await get('after=0&ack=0&realtimeAfter=0');
  assert.equal(first.body.cursor,40);assert.deepEqual(first.body.realtimeEvents.map(e=>e.seq),[97]);assert.equal(first.body.realtimeCursor,97);
  assert.equal((await spool.read(0))[0].seq,1);
  const next=await get('after=40&ack=40&realtimeAfter=97');
  assert.equal(next.body.cursor,80);assert.deepEqual(next.body.realtimeEvents,[]);
  assert.equal((await spool.read(0))[0].seq,41);
  const paused=await get('after=40&ack=40&realtimeAfter=0&limit=0');
  assert.deepEqual(paused.body.events,[]);assert.equal(paused.body.cursor,40);
  assert.deepEqual(paused.body.realtimeEvents.map(e=>e.seq),[97]);
  assert.equal((await spool.read(0))[0].seq,41,'pausing replay cannot discard unprocessed history');
  const replay=await get('after=80&ack=80&realtimeAfter=98');
  assert.ok(replay.body.events.some(e=>e.seq===97),'the durable event must remain available for replay');
  assert.equal((await get('after=0&realtimeAfter=-1')).status,400);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('startup reads recent persisted messages after restart without treating history as live or acknowledging gaps',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'wap-events-recent-'));
 try{
  const key=randomBytes(32);let spool=await createEventSpool(dir,key);
  for(let seq=1;seq<=100;seq++)spool.record({seq,type:'contacts.sync',payload:{items:[{id:'contact-'+seq}]}});
  spool.record({seq:101,type:'messages.sync',payload:{live:true,items:Array.from({length:250},(_,i)=>({id:'m-'+i}))}});
  await spool.flush();spool=await createEventSpool(dir,key);
  const handler=createBaileysRequestHandler({token:'test',port:0,sequence:101,events:[],eventSpool:spool,statusPayload:()=>({protocolVersion:1})});
  let body;
  await handler({method:'GET',url:'/events?after=0&ack=0&realtimeAfter=0&recent=1&recentLimit=260',headers:{'x-wap-token':'test'}},{setHeader(){},writeHead(code){assert.equal(code,200);},end(data){body=JSON.parse(data);}});
  assert.equal(body.cursor,40);
  assert.deepEqual(body.realtimeEvents,[]);
  assert.equal(body.recentEvents.length,1);
  assert.equal(body.recentEvents[0].payload.live,false);
  assert.equal(body.recentEvents[0].payload.items.length,250);
  assert.equal(body.recentEvents[0].payload.items[0].id,'m-0');
  assert.equal((await spool.read(0))[0].seq,1,'recent preview must not erase earlier durable events');
  assert.equal((await spool.read(100))[0].payload.items.length,250,'normal replay must retain the complete event');
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('an empty HTTP page cannot advance the cursor past a concurrent unseen arrival',async()=>{
 let sequence=5,body;
 const handler=createBaileysRequestHandler(()=>({token:'test',port:0,sequence,events:[],statusPayload:()=>({}),eventSpool:{acknowledge:async()=>{},read:async()=>{sequence=6;return[];}}}));
 await handler({method:'GET',url:'/events?after=5',headers:{'x-wap-token':'test'}},{setHeader(){},writeHead(){},end(data){body=JSON.parse(data);}});
 assert.equal(body.cursor,5);assert.deepEqual(body.events,[]);
});

test('legacy plaintext and interrupted writes migrate without losing data; wrong keys and tampering fail closed',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'wap-events-migrate-')),key=randomBytes(32);
 try{
  writeFileSync(join(dir,'0000000000000001.json'),JSON.stringify({seq:1,type:'messages.sync',payload:{body:'PRIVATE_TEST_TEXT'}}));
  writeFileSync(join(dir,'0000000000000002.json.tmp'),JSON.stringify({seq:2,type:'messages.sync',payload:{body:'RECOVERED_PRIVATE_TEXT'}}));
  const spool=await createEventSpool(dir,key,{warningBytes:1});
  assert.deepEqual((await spool.read(0)).map(event=>event.seq),[1,2]);assert.match(spool.health.warning,/积压/);
  for(const name of readdirSync(dir))assert.equal(readFileSync(join(dir,name)).includes(Buffer.from('PRIVATE_TEXT')),false);
  assert.equal(readdirSync(dir).some(name=>name.endsWith('.tmp')),false);
  await assert.rejects(()=>createEventSpool(dir,randomBytes(32)));
  const file=join(dir,'0000000000000001.json'),bytes=readFileSync(file);bytes[bytes.length-1]^=1;writeFileSync(file,bytes);
  await assert.rejects(()=>createEventSpool(dir,key));
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('disk errors are visible, never acknowledge failed writes, and retain pending records for retry',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'wap-events-failure-')),key=randomBytes(32);
 try{
  let pauses=0;const spool=await createEventSpool(dir,key,{retryMs:100_000,onPause:()=>pauses++});
  const {mkdirSync}=await import('node:fs');
  const blocked=join(dir,'0000000000000001-0000000000000001.pack.tmp');mkdirSync(blocked);
  spool.record({seq:1,type:'messages.sync',payload:{body:'keep'}});
  await assert.rejects(()=>spool.flush());assert.match(spool.health.warning,/写入失败/);
  assert.equal(spool.health.receivingPaused,true);assert.equal(pauses,1);
  await assert.rejects(()=>spool.recover());assert.equal(spool.health.receivingPaused,true);assert.equal(pauses,1);
  await assert.rejects(()=>spool.acknowledge(1));assert.ok(spool.health.pendingBytes>0);
  rmSync(blocked,{recursive:true,force:true});await spool.flush();assert.equal((await spool.read(0)).length,1);
  assert.equal(spool.health.receivingPaused,true,'successful background retries must not silently reconnect');
  await spool.recover();assert.equal(spool.health.receivingPaused,false);
  await spool.acknowledge(1);assert.equal(spool.health.pendingBytes,0);assert.deepEqual(await spool.read(0),[]);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('complete interrupted encrypted batches are recovered and partial fragments remain encrypted for diagnosis',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'wap-events-interrupted-')),key=randomBytes(32);
 try{
  let spool=await createEventSpool(dir,key);spool.record({seq:1,type:'messages.sync',payload:{body:'recovered'}});await spool.flush();
  const name=readdirSync(dir).find(name=>name.endsWith('.pack'));renameSync(join(dir,name),join(dir,name+'.tmp'));
  spool=await createEventSpool(dir,key);assert.equal((await spool.read(0))[0].payload.body,'recovered');
  writeFileSync(join(dir,'0000000000000002-0000000000000002.pack.tmp'),'PRIVATE_INCOMPLETE_FRAGMENT');
  spool=await createEventSpool(dir,key);assert.match(spool.health.warning,/未完成片段/);assert.equal(spool.health.blocked,false);
  const fragment=readdirSync(dir).find(name=>name.endsWith('.recovery'));assert.ok(fragment);assert.equal(readFileSync(join(dir,fragment)).includes(Buffer.from('PRIVATE_INCOMPLETE_FRAGMENT')),false);
  writeFileSync(join(dir,'0000000000000002-0000000000000002.pack.tmp'),'SECOND_INCOMPLETE_FRAGMENT');
  spool=await createEventSpool(dir,key);assert.equal(readdirSync(dir).filter(name=>name.endsWith('.recovery')).length,2);
  assert.equal((await spool.read(0)).length,1);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
