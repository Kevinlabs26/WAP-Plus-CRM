import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { messageTimestampMs } from '../baileys-bridge/messageTimestamp.mjs';
const built=await build({stdin:{contents:`export {applyMessagesSync} from './src/store/messagesIngest.ts';export {mergeMessagesByTime} from './src/store/messageOrdering.ts';export {cleanHydratedMessages} from './src/store/hydrateMessageCleanup.ts';`,resolveDir:fileURLToPath(new URL('../',import.meta.url))},bundle:true,write:false,format:'esm',platform:'node',alias:{'@':fileURLToPath(new URL('../src',import.meta.url))}});
const {applyMessagesSync,mergeMessagesByTime,cleanHydratedMessages}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text+'\n//# sourceURL=message-sync-ordering-test.js').toString('base64'));
const peer={jid:'12025550123@s.whatsapp.net',phoneE164:'+12025550123',displayName:'Example'};
const time=minute=>`2026-10-31T12:${minute}:00.000Z`;
function setup(){
 const bag={contacts:[],chats:[],messages:[],nextSelectedChatId:null,nextSelectedContactId:null};
 const sync=items=>{applyMessagesSync({bag,items:items.map(item=>({...peer,direction:'out',...item})),payload:{source:'snapshot',live:false},deviceId:'wa-a',selfName:''});bag.messages=mergeMessagesByTime(bag.messages,[]);return bag.messages;};
 return {bag,sync};
}

test('distinct outgoing texts, photos and voices with identical bodies survive replay and media enrichment',()=>{
 const {bag,sync}=setup();
 sync([{id:'photo-1',body:'Shared caption',mediaType:'image',mediaPending:true,sentAt:time('19')},
 {id:'text-1',body:'Shared caption',sentAt:time('20')},
 {id:'photo-2',body:'Shared caption',mediaType:'image',mediaPending:true,sentAt:time('21')},
 {id:'voice-1',body:'[语音]',mediaType:'audio',mediaPtt:true,sentAt:time('15')},
 {id:'voice-2',body:'[语音]',mediaType:'audio',mediaPtt:true,sentAt:time('16')}]);
 assert.equal(bag.messages.length,5);assert.deepEqual(bag.messages.map(m=>m.waMessageId),['voice-1','voice-2','photo-1','text-1','photo-2']);
 sync([{id:'photo-1',body:'Shared caption',mediaType:'image',mediaUrl:'data:image/png;base64,AA==',sentAt:time('19')}]);
 assert.equal(bag.messages.length,5);assert.equal(bag.messages.find(m=>m.waMessageId==='photo-1').mediaUrl,'data:image/png;base64,AA==');
 assert.equal(bag.messages.find(m=>m.waMessageId==='text-1').mediaType,undefined);
 assert.equal(cleanHydratedMessages(JSON.parse(JSON.stringify(bag.messages))).length,5);
});

test('exact protocol identities repair old local times and media even when captions differ',()=>{
 const {bag,sync}=setup();sync([{id:'seed',body:'seed',sentAt:time('10')}]);
 const chat=bag.chats[0],contact=bag.contacts[0];
 bag.messages=[{id:'msg-local-voice',chatId:chat.id,contactId:contact.id,accountId:'wa-a',direction:'out',body:'[语音]',mediaType:'audio',waMessageId:'voice',sentAt:time('16'),deliveryStatus:'read'},
 {id:'msg-local-text',chatId:chat.id,contactId:contact.id,accountId:'wa-a',direction:'out',body:'Long text',waMessageId:'text',sentAt:time('15'),deliveryStatus:'sent'},
 {id:'msg-local-image',chatId:chat.id,contactId:contact.id,accountId:'wa-a',direction:'out',body:'[图片]',waMessageId:'image',sentAt:time('22'),deliveryStatus:'sent'}];
 sync([{id:'text',body:'Long text',sentAt:time('17')},{id:'voice',body:'[语音]',mediaType:'audio',sentAt:time('14')},
 {id:'image',body:'Actual caption',mediaType:'image',mediaPending:true,sentAt:time('19')}]);
 assert.equal(bag.messages.length,3);assert.deepEqual(bag.messages.map(m=>m.waMessageId),['voice','text','image']);
 assert.equal(bag.messages[0].sentAt,time('14'));assert.equal(bag.messages[0].deliveryStatus,'read');
 assert.equal(bag.messages[2].body,'Actual caption');assert.equal(bag.messages[2].mediaType,'image');
 assert.equal(bag.messages[2].mediaPending,true);
 sync([{id:'image',body:'Actual caption',mediaType:'image',mediaUrl:'data:image/png;base64,AA=='}]);
 assert.equal(bag.messages[2].sentAt,time('19'),'enrichment without a protocol timestamp must not use event arrival time');
});

test('unbound optimistic messages match their own media type and cannot steal another protocol ID',()=>{
 const {bag,sync}=setup();sync([{id:'seed',body:'seed',sentAt:time('10')}]);const base=bag.messages[0];
 bag.messages=[{...base,id:'msg-text',waMessageId:undefined,waKey:undefined,body:'Caption',sentAt:time('19'),mediaType:undefined,deliveryStatus:'pending'},
 {...base,id:'msg-image',waMessageId:undefined,waKey:undefined,body:'Caption',sentAt:time('19'),mediaType:'image',deliveryStatus:'pending'}];
 sync([{id:'new-photo',body:'Caption',mediaType:'image',sentAt:time('19')}]);
 assert.equal(bag.messages.length,2);assert.equal(bag.messages.find(m=>m.id==='msg-image').waMessageId,'new-photo');
 assert.equal(bag.messages.find(m=>m.id==='msg-text').waMessageId,undefined);
 sync([{id:'new-text',body:'Caption',sentAt:time('20')}]);
 assert.equal(bag.messages.find(m=>m.id==='msg-text').waMessageId,'new-text');
});

test('repeated incoming text with different protocol identities is not silently discarded',()=>{
 const {bag,sync}=setup();sync([{id:'one',direction:'in',body:'OK',sentAt:time('19')},{id:'two',direction:'in',body:'OK',sentAt:time('20')}]);
 assert.equal(bag.messages.length,2);
});

test('a selected conversation cannot steal another chat\'s unbound outgoing message',()=>{
 const {bag,sync}=setup();sync([{id:'seed',body:'seed',sentAt:time('10')}]);const original=bag.messages[0];
 bag.nextSelectedChatId=original.chatId;bag.nextSelectedContactId=original.contactId;
 bag.messages=[{...original,id:'msg-pending',waMessageId:undefined,waKey:undefined,body:'Same text',sentAt:time('19'),deliveryStatus:'pending'}];
 sync([{id:'different-chat',jid:'12025550124@s.whatsapp.net',phoneE164:'+12025550124',body:'Same text',sentAt:time('19')}]);
 assert.equal(bag.messages.length,2);assert.equal(bag.messages.find(m=>m.id==='msg-pending').waMessageId,undefined);
 assert.notEqual(bag.messages.find(m=>m.waMessageId==='different-chat').chatId,original.chatId);
});

test('protobuf, JSON, numeric-string and millisecond timestamps retain their actual time',()=>{
 const sec=1793449080,ms=sec*1000;
 for(const input of [sec,String(sec),BigInt(sec),{toNumber:()=>sec},{low:sec,high:0,unsigned:true},ms,String(ms),BigInt(ms)]) assert.equal(messageTimestampMs(input,123),ms);
 for(const input of [undefined,null,0,NaN,Infinity,'bad',{low:0,high:0},{}])assert.equal(messageTimestampMs(input,123),123);
});
