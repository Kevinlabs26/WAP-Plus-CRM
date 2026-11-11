import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createBaileysRequestHandler,MAX_AUDIO_FILE_BYTES} from '../baileys-bridge/httpServer.mjs';
import {MAX_AUDIO_BYTES} from '../src/lib/mediaBlob.ts';
test('ordinary audio accepts the expanded boundary and rejects excess bytes without sending',async()=>{
 assert.equal(MAX_AUDIO_BYTES,MAX_AUDIO_FILE_BYTES);
 const sent=[];const handler=createBaileysRequestHandler({token:'test',port:17891,connection:'connected',socket:{sendMessage:async(_jid,payload)=>{sent.push(payload.audio.length);return {key:{id:'mock'}};}},resolveSendJid:async()=> '15551234567@s.whatsapp.net'});
 for(const bytes of [15*1024*1024,MAX_AUDIO_BYTES,MAX_AUDIO_BYTES+1]){
  const req=Readable.from([JSON.stringify({phoneE164:'+15551234567',audioDataUrl:'data:audio/mpeg;base64,'+Buffer.alloc(bytes).toString('base64'),mediaType:'audio',ptt:false,mimetype:'audio/mpeg'})]);Object.assign(req,{method:'POST',url:'/send',headers:{'x-wap-token':'test'}});
  const res={status:0,body:'',setHeader(){},writeHead(status){this.status=status;},end(body){this.body=body;}};
  await handler(req,res);assert.equal(res.status,bytes>MAX_AUDIO_BYTES?400:200,res.body);
 }
 assert.deepEqual(sent,[15*1024*1024,MAX_AUDIO_BYTES]);
});
