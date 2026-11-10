import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const mocks={
 '@/lib/storage':'export const loadFullHistory=async()=>null;',
 '@/lib/mediaCache':'export const waitForMediaCacheWrites=async()=>{};export const readMediaCache=async id=>globalThis.backupCache.get(id);',
};
const built=await build({stdin:{contents:`export {createBackupBundle} from './src/store/exportDataActions.ts';export {parseBackupJson,sanitizeMediaUrl} from './src/lib/exportData.ts';`,resolveDir:fileURLToPath(new URL('../',import.meta.url))},bundle:true,write:false,format:'esm',platform:'node',alias:{'@':fileURLToPath(new URL('../src',import.meta.url))},plugins:[{name:'backup-io',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
const {createBackupBundle,parseBackupJson}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const state=messages=>({phones:[],contacts:[],chats:[],messages,followUps:[],activities:[],broadcastCampaigns:[],settings:{}});
const message=(id,mediaUrl)=>({id,chatId:'chat',direction:'out',body:'Video',sentAt:'2026-11-09T00:00:00Z',mediaType:'video',mediaUrl});
test('a 100 MB video can be included in an attachment backup and restored without being dropped',async()=>{
 const original={fetch:globalThis.fetch,FileReader:globalThis.FileReader};
 const bytes=100*1024*1024;
 const data='data:video/mp4;base64,'+'A'.repeat(Math.ceil(bytes/3)*4-2)+'==';
 let reads=0;
 globalThis.backupCache=new Map([['video','blob:fixture-video']]);
 globalThis.fetch=async()=>({ok:true,blob:async()=>({size:bytes,type:'video/mp4'})});
 globalThis.FileReader=class{readAsDataURL(blob){assert.equal(blob.size,bytes);reads++;this.result=data;queueMicrotask(()=>this.onload());}};
 try{
  const exported=await createBackupBundle(state([message('video','blob:fixture-video')]),true);
  assert.equal(reads,1);assert.equal(exported.attached,1);assert.equal(exported.bundle.messages[0].mediaUrl,data);
  assert.equal(parseBackupJson(exported.bundle).messages[0].mediaUrl,data);
 }finally{Object.assign(globalThis,original);delete globalThis.backupCache;}
});
test('oversized attachment totals fail explicitly while a backup without attachments remains available',async()=>{
 const data='data:video/mp4;base64,'+'A'.repeat(30*1024*1024);
 const messages=Array.from({length:7},(_,i)=>message(String(i),data));
 globalThis.backupCache=new Map();
 try{
  await assert.rejects(createBackupBundle(state(messages),true),/192 MB/);
  const exported=await createBackupBundle(state(messages),false);
  assert.equal(exported.attached,0);assert.ok(exported.bundle.messages.every(item=>!item.mediaUrl));
  assert.throws(()=>parseBackupJson({version:2,messages}),/192 MB/);
 }finally{delete globalThis.backupCache;}
});
