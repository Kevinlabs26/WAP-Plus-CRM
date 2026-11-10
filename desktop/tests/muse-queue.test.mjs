import test from 'node:test';
import assert from 'node:assert/strict';
import {enqueueMuseTask,museQueueSnapshot} from '../src/lib/museQueue.ts';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('image generation has a separate lane, and waiting replies run ahead of lower priority text work',async()=>{
 const image=deferred(),text=deferred(),calls=[];
 const media=enqueueMuseTask('media',async()=>{calls.push('image');await image.promise;});
 const first=enqueueMuseTask('text',async()=>{calls.push('first');await text.promise;});await flush();
 assert.deepEqual(calls,['image','first']);
 const slow=enqueueMuseTask('text',async()=>calls.push('background'),undefined,0);
 const reply=enqueueMuseTask('text',async()=>calls.push('reply'),undefined,2);
 assert.equal(museQueueSnapshot().textWaiting,2);text.resolve();await Promise.all([first,slow,reply]);
 assert.deepEqual(calls,['image','first','reply','background']);assert.equal(museQueueSnapshot().mediaRunning,1);
 image.resolve();await media;await flush();assert.equal(museQueueSnapshot().mediaRunning,0);
});
test('cancelled queued work is removed immediately and never reaches the provider; failures release their lane',async()=>{
 const gate=deferred(),controller=new AbortController();let started=false;
 const first=enqueueMuseTask('text',async()=>gate.promise);await flush();
 const queued=enqueueMuseTask('text',async()=>{started=true;},controller.signal);
 controller.abort();await assert.rejects(queued,{name:'AbortError'});assert.equal(museQueueSnapshot().textWaiting,0);
 gate.resolve();await first;assert.equal(started,false);
 await assert.rejects(enqueueMuseTask('text',async()=>{throw Error('provider failed');}));
 assert.equal(await enqueueMuseTask('text',async()=> 'next'),'next');
});

test('queue growth and waiting time are bounded without submitting expired work',async t=>{
 const gate=deferred();const active=enqueueMuseTask('text',()=>gate.promise);await flush();
 const controller=new AbortController();
 const pending=Array.from({length:100},()=>enqueueMuseTask('text',async()=>assert.fail('cancelled work ran'),controller.signal).catch(error=>error));
 await assert.rejects(enqueueMuseTask('text',async()=>null),/429/);
 controller.abort();await Promise.all(pending);assert.equal(museQueueSnapshot().textWaiting,0);
 t.mock.timers.enable({apis:['setTimeout']});
 const expired=enqueueMuseTask('text',async()=>assert.fail('expired work ran'));
 const rejection=assert.rejects(expired,/5 分钟/);t.mock.timers.tick(300_000);await rejection;
 gate.resolve();await active;assert.equal(museQueueSnapshot().textWaiting,0);
});
