import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {stat, access, mkdtemp, utimes, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createBaileysRequestHandler} from '../baileys-bridge/httpServer.mjs';
import {receiveVideoUpload, MAX_VIDEO_BYTES, cleanupAbandonedVideos} from '../baileys-bridge/videoUpload.mjs';

test('abandoned temporary videos are removed while fresh uploads remain',async()=>{
 const stale=await mkdtemp(join(tmpdir(),'wap-plus-video-'));
 const fresh=await mkdtemp(join(tmpdir(),'wap-plus-video-'));
 try {
  await utimes(stale,new Date(0),new Date(0));await cleanupAbandonedVideos();
  await assert.rejects(access(stale));await access(fresh);
 }finally{await rm(stale,{recursive:true,force:true});await rm(fresh,{recursive:true,force:true});}
});

function * wire(size, metadata = {}, actual = size) {
  const header=Buffer.from(JSON.stringify({phoneE164:'+12025550123',caption:'test caption',size,...metadata}));
  const length=Buffer.alloc(4);length.writeUInt32BE(header.length);
  yield length.subarray(0,1);yield length.subarray(1);yield header.subarray(0,2);yield header.subarray(2);
  const chunk=Buffer.alloc(256*1024);
  for(let remaining=actual;remaining>0;remaining-=chunk.length)yield chunk.subarray(0,Math.min(remaining,chunk.length));
}

for(const mb of [75,100])test(`${mb} MB upload streams to a temporary file and is removed after send`,async()=>{
  let temporary,reply,calls=0;
  const handler=createBaileysRequestHandler({token:'fixture',port:1,connection:'connected',resolveSendJid:async()=> '12025550123@s.whatsapp.net',socket:{sendMessage:async(jid,content)=>{
    calls++;assert.equal(jid,'12025550123@s.whatsapp.net');assert.equal(content.caption,'test caption');
    temporary=content.video.url;assert.equal((await stat(temporary)).size,mb*1024*1024);
    assert.equal(Buffer.isBuffer(content.video),false);return {key:{id:'video'}};
  }}});
  const request=Readable.from(wire(mb*1024*1024));Object.assign(request,{method:'POST',url:'/send/video',headers:{'x-wap-token':'fixture'}});
  await handler(request,{setHeader(){},writeHead(status){assert.equal(status,200);},end(value){reply=JSON.parse(value);}});
  assert.equal(calls,1);assert.equal(reply.ok,true);await assert.rejects(access(temporary));
});
test('oversized, malformed and incomplete streams never produce an upload',async()=>{
  await assert.rejects(receiveVideoUpload(Readable.from(wire(MAX_VIDEO_BYTES+1,{},0))),error=>error.status===413);
  await assert.rejects(receiveVideoUpload(Readable.from(wire(3,{},2))),/不完整/);
  await assert.rejects(receiveVideoUpload(Readable.from(wire(3,{caption:[]},0))),/信息无效/);
  const length=Buffer.alloc(4);length.writeUInt32BE(65537);
  await assert.rejects(receiveVideoUpload(Readable.from([length])),/信息无效/);
});
test('failed or cancelled sends clean their temporary video and do not acknowledge success',async()=>{
  let temporary,status;
  const handler=createBaileysRequestHandler({token:'fixture',port:1,connection:'connected',resolveSendJid:async()=> '12025550123@s.whatsapp.net',socket:{sendMessage:async(_jid,content)=>{temporary=content.video.url;throw Error('upload failed');}}});
  const request=Readable.from(wire(16));Object.assign(request,{method:'POST',url:'/send/video',headers:{'x-wap-token':'fixture'}});
  await handler(request,{setHeader(){},writeHead(value){status=value;},end(){}});
  assert.equal(status,500);await assert.rejects(access(temporary));
});
test('stream endpoint requires authentication before reading any video bytes',async()=>{
  let read=false,status;
  const request=Readable.from((async function *(){read=true;yield Buffer.alloc(4);})());Object.assign(request,{method:'POST',url:'/send/video',headers:{}});
  await createBaileysRequestHandler({token:'fixture'}) (request,{setHeader(){},writeHead(value){status=value;},end(){}});
  assert.equal(status,401);assert.equal(read,false);
});
