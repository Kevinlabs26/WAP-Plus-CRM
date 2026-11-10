import assert from "node:assert/strict";
import test from "node:test";

import {
  bridgeMessageMediaCacheId,
  selectMediaCacheEvictions,
  cacheMediaUrl,
  cacheMediaBlob,
  readMediaCache,
  dropMediaCache,
  clearMediaCache,
} from "../src/lib/mediaCache.ts";

test("media cache evicts the oldest entries until it is under the limit", () => {
  const index = {
    old: { chars: 60, cachedAt: 1 },
    middle: { chars: 50, cachedAt: 2 },
    newest: { chars: 40, cachedAt: 3 },
  };
  assert.deepEqual(selectMediaCacheEvictions(index, 90), ["old"]);
  assert.deepEqual(selectMediaCacheEvictions(index, 50), ["old", "middle"]);
});

test("bridge media uses the same local message id as persisted messages", () => {
  assert.equal(
    bridgeMessageMediaCacheId("ABC/123", "account-1"),
    "bridge-msg-account-1-ABC%2F123"
  );
});

test('favorites are never removed by ordinary media cache eviction',()=>{
 assert.deepEqual(selectMediaCacheEvictions({'saved-photo':{chars:60,cachedAt:1},download:{chars:60,cachedAt:2}},70),['download']);
});

test('cache writes are atomic on quota failure and ordinary clearing preserves saved attachments',async()=>{
 const values=new Map([['media-cache-index-v1',{}]]);let failKey;
 const old=globalThis.indexedDB;
 globalThis.indexedDB={open(){
  const request={};queueMicrotask(()=>{
   request.result={transaction(){
    let aborted=false;const draft=new Map(values),tx={abort(){aborted=true;}};
    tx.objectStore=()=>({
     get(key){const req={};queueMicrotask(()=>{req.result=structuredClone(values.get(key));req.onsuccess();});return req;},
     put(value,key){if(key===failKey)throw Error('quota exceeded');draft.set(key,structuredClone(value));},
     delete(key){draft.delete(key);},
    });
    queueMicrotask(()=>{if(aborted){tx.onabort?.();return;}values.clear();for(const entry of draft)values.set(...entry);tx.oncomplete?.();});
    return tx;
   }};request.onsuccess();
  });return request;
 }};
 try{
  const url='data:image/png;base64,AAAA';
  failKey='media:failed';await assert.rejects(cacheMediaUrl('failed',url,true),/quota/);
  assert.deepEqual(values.get('media-cache-index-v1'),{});assert.equal(values.has('media:failed'),false);
  failKey=undefined;await cacheMediaUrl('saved-photo',url,true);await cacheMediaUrl('chat-photo',url,true);
  const video=new Blob(['raw video bytes'],{type:'video/mp4'});
  const videoUrl=await cacheMediaBlob('video',video);
  assert.ok(values.get('media:video') instanceof Blob);
  assert.equal(values.get('media-cache-index-v1').video.chars,video.size);
  assert.match(videoUrl,/^blob:/);assert.equal(await readMediaCache('video'),videoUrl);
  assert.equal(await (await fetch(videoUrl)).text(),'raw video bytes');
  const reopened=await import('../src/lib/mediaCache.ts?video-cache-reopen');
  const reopenedUrl=await reopened.readMediaCache('video',true);
  assert.match(reopenedUrl,/^blob:/);assert.equal(await (await fetch(reopenedUrl)).text(),'raw video bytes');
  URL.revokeObjectURL(reopenedUrl);
  await dropMediaCache('video');assert.equal(values.has('media:video'),false);
  await assert.rejects(fetch(videoUrl));
  assert.equal(await clearMediaCache(),1);
  assert.equal(values.get('media:saved-photo'),url);assert.equal(values.has('media:chat-photo'),false);
  assert.deepEqual(Object.keys(values.get('media-cache-index-v1')),['saved-photo']);
 }finally{globalThis.indexedDB=old;}
});
