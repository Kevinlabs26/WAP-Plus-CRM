import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {fileURLToPath} from 'node:url';
const result=await build({entryPoints:[fileURLToPath(new URL('../src/store/saveMessageAction.ts',import.meta.url))],bundle:true,write:false,format:'esm',platform:'node',alias:{'@':fileURLToPath(new URL('../src',import.meta.url))},plugins:[{name:'favorite-cache',setup(b){b.onResolve({filter:/^@\/lib\/mediaCache$/},()=>({path:'cache',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:`export const cacheMediaBlob=async(id,blob)=>{if(globalThis.favoriteFailure)throw Error('disk full');const url=URL.createObjectURL(blob);globalThis.favoriteCache.set(id,url);return url;};export const readMediaCache=async id=>globalThis.favoriteCache.get(id);export const dropMediaCache=async id=>globalThis.favoriteCache.delete(id);export const cacheMediaUrl=async(id,url,strict)=>{if(globalThis.favoriteFailure)throw Error('disk full');if(globalThis.favoriteGate)await globalThis.favoriteGate;globalThis.favoriteCache.set(id,url);};`}));}}]});
const {createSaveMessageAction}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
function fixture(){globalThis.favoriteCache=new Map();globalThis.favoriteFailure=false;globalThis.favoriteGate=null;const source={id:'source',chatId:'chat',direction:'in',body:'Photo',sentAt:'2026-01-01T00:00:00Z',mediaType:'image',mediaUrl:'data:image/png;base64,AAAA'};let state={messages:[source],chats:[]},saved=0;const actions=createSaveMessageAction({getMessages:()=>state.messages,getChats:()=>state.chats,getContacts:()=>[],setState:p=>state={...state,...p},persist:async()=>{saved++;}});return {actions,get state(){return state},get saved(){return saved}};}
test('favorites own their attachment before success and remain usable after the source cache is removed',async()=>{
 const h=fixture();assert.equal(await h.actions.saveMessageToSelf('source'),true);const saved=h.state.messages.find(m=>m.savedFromMessageId);
 assert.equal(globalThis.favoriteCache.get(saved.id),saved.mediaUrl);globalThis.favoriteCache.delete('source');assert.ok(globalThis.favoriteCache.get(saved.id));assert.equal(h.saved,1);
});
test('disk errors do not create an empty favorite or report success',async()=>{
 const h=fixture();globalThis.favoriteFailure=true;await assert.rejects(h.actions.saveMessageToSelf('source'),/disk full/);assert.equal(h.state.messages.length,1);assert.equal(h.saved,0);
});
test('saving an attachment never overwrites newly received messages while disk writes are pending',async()=>{
 const h=fixture();let release;globalThis.favoriteGate=new Promise(r=>release=r);const task=h.actions.saveMessageToSelf('source');h.state.messages.push({id:'newly-arrived',chatId:'chat'});release();await task;assert.ok(h.state.messages.some(m=>m.id==='newly-arrived'));assert.equal(h.state.messages.length,3);
});
test('a 100 MB video is saved as an independent binary attachment without Base64 conversion',async()=>{
 const h=fixture(),blob=new Blob([new Uint8Array(100*1024*1024)],{type:'video/mp4'});
 const sourceUrl=URL.createObjectURL(blob);let savedUrl;
 h.state.messages[0].mediaType='video';h.state.messages[0].mediaUrl=sourceUrl;globalThis.favoriteCache.set('source',sourceUrl);
 try{
  assert.equal(await h.actions.saveMessageToSelf('source'),true);
  const saved=h.state.messages.find(item=>item.savedFromMessageId);savedUrl=saved.mediaUrl;
  assert.match(savedUrl,/^blob:/);assert.notEqual(savedUrl,sourceUrl);URL.revokeObjectURL(sourceUrl);
  assert.equal((await (await fetch(savedUrl)).blob()).size,100*1024*1024);
 }finally{URL.revokeObjectURL(sourceUrl);if(savedUrl)URL.revokeObjectURL(savedUrl);globalThis.favoriteCache.clear();}
});
