import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {stat,access} from 'node:fs/promises';
import {createBaileysRequestHandler} from '../baileys-bridge/httpServer.mjs';
import {receiveVideoUpload,MAX_VIDEO_BYTES} from '../baileys-bridge/videoUpload.mjs';
function *wire(size,extra={},actual=size){const header=Buffer.from(JSON.stringify({phoneE164:'+15551234567',caption:'Lecture',fileName:'Course.mp3',mimetype:'audio/mpeg',size,...extra}));const length=Buffer.alloc(4);length.writeUInt32BE(header.length);yield length;yield header;const chunk=Buffer.alloc(256*1024,9);for(let n=actual;n>0;n-=chunk.length)yield chunk.subarray(0,Math.min(n,chunk.length));}
for(const size of [30*1024*1024,MAX_VIDEO_BYTES])test('document upload preserves original audio bytes, filename and MIME at '+size+' bytes',async()=>{
 let path,calls=0,status;
 const handler=createBaileysRequestHandler({token:'test',port:1,connection:'connected',resolveSendJid:async()=> '15551234567@s.whatsapp.net',socket:{sendMessage:async(_jid,payload)=>{calls++;assert.equal(payload.fileName,'Course.mp3');assert.equal(payload.mimetype,'audio/mpeg');assert.equal(payload.audio,undefined);path=payload.document.url;assert.equal((await stat(path)).size,size);return {key:{id:'mock'}};}}});
 const req=Readable.from(wire(size));Object.assign(req,{method:'POST',url:'/send/document',headers:{'x-wap-token':'test'}});
 await handler(req,{setHeader(){},writeHead(s){status=s;},end(){}});assert.equal(status,200);assert.equal(calls,1);await assert.rejects(access(path));
});
test('document upload rejects excess, malformed metadata, truncation and unauthenticated requests',async()=>{
 await assert.rejects(receiveVideoUpload(Readable.from(wire(MAX_VIDEO_BYTES+1,{},0)),true),e=>e.status===413);
 await assert.rejects(receiveVideoUpload(Readable.from(wire(3,{fileName:''},0)),true),/信息无效/);
 await assert.rejects(receiveVideoUpload(Readable.from(wire(3,{mimetype:'bad'},0)),true),/信息无效/);
 await assert.rejects(receiveVideoUpload(Readable.from(wire(3,{mimetype:'audio /mpeg'},0)),true),/信息无效/);
 await assert.rejects(receiveVideoUpload(Readable.from(wire(3,{},2)),true),/不完整/);
 let read=false,status;const req=Readable.from((async function*(){read=true;yield Buffer.alloc(4);})());Object.assign(req,{method:'POST',url:'/send/document',headers:{}});
 await createBaileysRequestHandler({token:'test'})(req,{setHeader(){},writeHead(s){status=s;},end(){}});assert.equal(status,401);assert.equal(read,false);
});
