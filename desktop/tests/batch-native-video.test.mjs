import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createBaileysRequestHandler} from '../baileys-bridge/httpServer.mjs';

async function send(payload){
 let status,body;const calls=[];const handler=createBaileysRequestHandler({token:'test',port:1,connection:'connected',resolveSendJid:async()=> '12345@g.us',socket:{sendMessage:async(...args)=>{calls.push(args);return {key:{id:'video-id'}};}}});
 const req=Readable.from([Buffer.from(JSON.stringify({phoneE164:'12345@g.us',...payload}))]);Object.assign(req,{method:'POST',url:'/send',headers:{'x-wap-token':'test'}});
 await handler(req,{setHeader(){},writeHead(s){status=s;},end(value){body=JSON.parse(value);}});return {status,body,calls};
}
test('MP4 sends one native video with its caption, without a text fallback',async()=>{
 const result=await send({mediaType:'video',videoDataUrl:'data:video/mp4;base64,AAAAAGZ0eXA=',text:'caption'});
 assert.equal(result.status,200);assert.equal(result.calls.length,1);const content=result.calls[0][1];assert.ok(Buffer.isBuffer(content.video));assert.equal(content.caption,'caption');assert.equal(content.gifPlayback,undefined);assert.equal(content.document,undefined);
});
test('invalid native video is rejected even when it has a caption',async()=>{
 for(const videoDataUrl of ['data:video/webm;base64,AA==','not a data URL','data:video/mp4;base64,']){
  const result=await send({mediaType:'video',videoDataUrl,text:'must not send text alone'});assert.equal(result.status,400);assert.equal(result.calls.length,0);
 }
});
test('native videos above the old 8 MB limit reach the transport, and oversized JSON uploads fail explicitly', async()=>{
 const data=Buffer.alloc(9*1024*1024).toString('base64');
 const sent=await send({mediaType:'video',videoDataUrl:`data:video/mp4;base64,${data}`,text:'caption'});
 assert.equal(sent.status,200);assert.equal(sent.calls[0][1].video.length,9*1024*1024);
 const large=Buffer.alloc(100*1024*1024+1).toString('base64');
 const rejected=await send({mediaType:'video',videoDataUrl:`data:video/mp4;base64,${large}`});
 assert.equal(rejected.status,413);assert.match(rejected.body.error,/request too large|100 MB/);assert.equal(rejected.calls.length,0);
});
