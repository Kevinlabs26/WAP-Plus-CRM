import test from 'node:test';import assert from 'node:assert/strict';
import {trimMessageMemory,retainMessageChats} from '../src/store/messageMemory.ts';
test('memory eviction preserves active windows, local favorites, stars and unfinished sends',()=>{
 const messages=Array.from({length:30000},(_,i)=>({id:String(i),chatId:'background',sentAt:new Date(1700000000000+i).toISOString(),direction:'in'}));
 for(const item of [{id:'active',chatId:'active'}, {id:'window',chatId:'window'}, {id:'favorite',chatId:'bridge-chat-saved-messages'}, {id:'star',chatId:'old',starred:true}, {id:'queued',chatId:'old',direction:'out',deliveryStatus:'queued'}])messages.unshift({...item,sentAt:'2020-01-01T00:00:00Z'});
 retainMessageChats('test',['window']);try{const kept=trimMessageMemory(messages,'active');assert.equal(kept.length,20005);assert.equal(messages.length,30005);for(const id of ['active','window','favorite','star','queued'])assert.ok(kept.some(m=>m.id===id));assert.ok(!kept.some(m=>m.id==='0'));}finally{retainMessageChats('test',[]);}
});
