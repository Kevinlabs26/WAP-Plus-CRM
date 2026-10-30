import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

import {
  mediaPlaceholderState,
  QUIET_MEDIA_RETRY_DELAYS_MS,
  shouldAutoLoadMessageMedia,
  shouldRetryMediaAfterSync,
} from "../src/components/chat/messageMediaUtils.ts";

test("media placeholders distinguish loading, retry and failure", () => {
  assert.equal(mediaPlaceholderState({}, true), "loading");
  assert.equal(mediaPlaceholderState({ mediaPending: true }, false), "loading");
  assert.equal(mediaPlaceholderState({}, false), "retry");
  assert.equal(
    mediaPlaceholderState({ mediaError: "raw message missing" }, false),
    "failed"
  );
  assert.equal(
    mediaPlaceholderState({ mediaUrl: "data:audio/ogg;base64,x", mediaError: "old" }, false),
    "retry"
  );
});

test("quiet media reload retries brief WhatsApp delivery gaps", () => {
  assert.deepEqual(QUIET_MEDIA_RETRY_DELAYS_MS, [800, 2400]);
});

test("media reload only resyncs for a missing bridge message", () => {
  assert.equal(shouldRetryMediaAfterSync({ status: 404 }), true);
  assert.equal(shouldRetryMediaAfterSync({ status: 500 }), false);
  assert.equal(shouldRetryMediaAfterSync(new Error("network error")), false);
});

test("visible voice messages auto-load even from older persisted snapshots", () => {
  assert.equal(
    shouldAutoLoadMessageMedia({ mediaType: "audio", mediaPending: true }),
    true
  );
  assert.equal(
    shouldAutoLoadMessageMedia({ mediaType: "audio", mediaPending: undefined }),
    true
  );
  assert.equal(
    shouldAutoLoadMessageMedia({
      mediaType: "audio",
      mediaPending: true,
      mediaUrl: "data:audio/ogg;base64,cached",
    }),
    false
  );
});

test("non-visible-prefetch media stays manual", () => {
  assert.equal(
    shouldAutoLoadMessageMedia({ mediaType: "video", mediaPending: true }),
    false
  );
  assert.equal(
    shouldAutoLoadMessageMedia({ mediaType: "image", mediaPending: false }),
    false
  );
});

test('cancelled voice download releases its slot without syncing, retrying or showing a failure',async()=>{
 const mocks={
  '@/lib/baileys':'export const baileysDownloadMedia=(key,opts)=>globalThis.cancelMediaDownload(key,opts);export const baileysSync=()=>{throw new Error("unexpected sync");};export const baileysFetchMessageHistory=()=>{throw new Error("unexpected history fetch");};',
  '@/lib/bridge':'export const bridgeInvoke=()=>{throw new Error("unexpected Android request");};',
  '@/lib/mediaCache':'export const bridgeMessageMediaCacheId=id=>id;export const cacheMediaUrl=async()=>{};export const readMediaCache=async()=>null;',
  '@/i18n':'export const translateCurrent=k=>k;',
 };
 const built=await build({entryPoints:[fileURLToPath(new URL('../src/components/chat/reloadMediaAction.ts',import.meta.url))],bundle:true,write:false,format:'esm',platform:'browser',alias:{'@':fileURLToPath(new URL('../src',import.meta.url))},plugins:[{name:'cancel-download',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
 const {reloadMedia}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
 let started=false,calls=0;const controller=new AbortController(),patches=[],toasts=[],inFlight=new Set();
 globalThis.cancelMediaDownload=(_key,opts)=>{calls++;started=true;return new Promise((_,reject)=>opts.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));};
 try{
  const message={id:'voice-cancel',mediaType:'audio'};
  const running=reloadMedia({message,sourceMessage:message,isBaileys:true,chatConnected:true,chatAccountId:'qa',activeContactName:'Test',mediaResyncAt:new Map(),mediaInFlight:inFlight,setMediaBusyId(){},resolveMessageKey:()=>({id:'voice-key',remoteJid:'12025550101@s.whatsapp.net'}),updateMessageDelivery:(_id,p)=>patches.push(p),pushToast:(...args)=>toasts.push(args),quiet:true,signal:controller.signal});
  while(!started)await new Promise(resolve=>setImmediate(resolve));controller.abort();await running;
  assert.equal(calls,1);assert.equal(inFlight.size,0);assert.deepEqual(toasts,[]);assert.equal(patches.some(p=>p.mediaError!==undefined),false);
 }finally{delete globalThis.cancelMediaDownload;}
});
