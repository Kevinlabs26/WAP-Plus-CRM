import test, {beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';

const mocks={
 '@/lib/bridge':'export const isTauri=()=>true;export const bridgeInvoke=(...args)=>globalThis.videoRuntime(...args);',
 '@/lib/syncDebug':'export const syncLog=()=>{};',
};
const out=await build({stdin:{contents:`export {baileysSendVideo} from './src/lib/baileysSend.ts';export {resetBaileysRuntimeCache} from './src/lib/baileysCore.ts';export {BAILEYS_BRIDGE_PROTOCOL_VERSION} from '@shared/baileysProtocol';`,resolveDir:fileURLToPath(new URL('../',import.meta.url))},bundle:true,write:false,format:'esm',platform:'node',alias:{'@':fileURLToPath(new URL('../src',import.meta.url)),'@shared':fileURLToPath(new URL('../../shared',import.meta.url))},plugins:[{name:'native-video-boundaries',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
const {baileysSendVideo,resetBaileysRuntimeCache,BAILEYS_BRIDGE_PROTOCOL_VERSION}=await import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text+'\n//# sourceURL=batch-video-capability-test.js').toString('base64'));
let originals,status,calls,onStatus,losePost;
const send=canSend=>baileysSendVideo('12345@g.us','data:video/mp4;base64,AAAAAGZ0eXA=','caption','owner',canSend);
test('raw Blob video uses the bounded binary stream instead of JSON/Base64',async()=>{
 const video=new Blob(['raw-video'],{type:'video/mp4'});
 await baileysSendVideo('12345@g.us',video,'caption','owner');
 assert.deepEqual(calls.map(c=>c.path),['/status','/send/video']);
 assert.equal(calls[1].options.headers['Content-Type'],'application/octet-stream');
 const body=calls[1].options.body;
 assert.ok(body instanceof Blob);const bytes=new Uint8Array(await body.arrayBuffer());
 const length=new DataView(bytes.buffer).getUint32(0);
 assert.deepEqual(JSON.parse(new TextDecoder().decode(bytes.slice(4,4+length))),{phoneE164:'12345@g.us',caption:'caption',size:video.size});
 assert.equal(new TextDecoder().decode(bytes.slice(4+length)),'raw-video');
});
test('an older bridge rejects a raw upload before transmission',async()=>{
 status.capabilities.nativeVideoStream=false;
 await assert.rejects(baileysSendVideo('12345@g.us',new Blob(['raw']),'','owner'),/重启/);
 assert.deepEqual(calls.map(c=>c.path),['/status']);
});
test('a large video restored from a backup retries as binary instead of exceeding the JSON request limit',async()=>{
 const data='data:video/mp4;base64,'+'A'.repeat(36*1024*1024);
 await baileysSendVideo('12345@g.us',data,'caption','owner');
 assert.deepEqual(calls.map(c=>c.path),['/status','/send/video']);
 assert.ok(calls[1].options.body instanceof Blob);
});
test('cached Blob video URLs retry through the same raw stream route',async()=>{
 const url=URL.createObjectURL(new Blob(['cached-video'],{type:'video/mp4'}));
 try {
  const fetchRequest=globalThis.fetch;
  globalThis.fetch=(input,options)=>String(input).startsWith('blob:')?originals.fetch(input,options):fetchRequest(input,options);
  await baileysSendVideo('12345@g.us',url,'caption','owner');
  assert.deepEqual(calls.map(c=>c.path),['/status','/send/video']);
 } finally {URL.revokeObjectURL(url);}
});
beforeEach(()=>{
 originals={fetch:globalThis.fetch,window:globalThis.window};calls=[];onStatus=undefined;losePost=false;resetBaileysRuntimeCache();
 status={protocolVersion:BAILEYS_BRIDGE_PROTOCOL_VERSION,connection:'connected',capabilities:{nativeVideo:true,nativeVideoStream:true},user:{id:'12025550123@s.whatsapp.net'}};
 globalThis.window={setTimeout:fn=>{queueMicrotask(fn);return 0;}};
 globalThis.videoRuntime=async()=>({baseUrl:'http://127.0.0.1:1234',token:'fixture',accountId:'owner'});
 globalThis.fetch=async(url,options)=>{
  const path=new URL(url).pathname;calls.push({path,options});
  if(path==='/status'){await onStatus?.();return {ok:true,status:200,json:async()=>status};}
  if(losePost)throw new TypeError('Failed to fetch');
  return {ok:true,status:200,json:async()=>({ok:true,id:'video-id'})};
 };
});
afterEach(()=>{Object.assign(globalThis,originals);delete globalThis.videoRuntime;});

test('a supported bridge receives one video only after its capability and owner are checked',async()=>{
 const result=await send(()=>true);assert.equal(result.id,'video-id');assert.deepEqual(calls.map(c=>c.path),['/status','/send']);
 const request=JSON.parse(calls[1].options.body);assert.equal(request.mediaType,'video');assert.equal(request.text,'caption');assert.equal(new Headers(calls[1].options.headers).get('x-wap-account-id'),'owner');
});
test('older or invalid capabilities block transport instead of silently sending the caption alone',async()=>{
 for(const capability of [undefined,false,'true']){
  calls=[];status.capabilities=capability===undefined?undefined:{nativeVideo:capability};
  await assert.rejects(send(()=>true),e=>e.code==='native_video_unsupported'&&e.deliveryUncertain===false);
  assert.ok(calls.length>0);assert.equal(calls.some(c=>c.path==='/send'),false);
 }
});
test('cancellation during the capability request prevents the subsequent send',async()=>{
 let allowed=true;onStatus=()=>{allowed=false;};
 await assert.rejects(send(()=>allowed),e=>e.code==='automation_cancelled'&&e.deliveryUncertain===false);assert.deepEqual(calls.map(c=>c.path),['/status']);
});
test('a failed or disconnected preflight never claims that a send was attempted',async()=>{
 onStatus=()=>{throw new TypeError('status unavailable');};
 await assert.rejects(send(),e=>e.deliveryUncertain===false);assert.equal(calls.some(c=>c.path==='/send'),false);
 onStatus=undefined;calls=[];status.connection='reconnecting';
 await assert.rejects(send(),e=>e.code==='baileys_not_connected'&&e.deliveryUncertain===false);assert.deepEqual(calls.map(c=>c.path),['/status']);
});
test('a lost video POST remains unknown and is never retried automatically',async()=>{
 losePost=true;await assert.rejects(send(()=>true),e=>e.deliveryUncertain===true);
 assert.equal(calls.filter(c=>c.path==='/send').length,1);
});
