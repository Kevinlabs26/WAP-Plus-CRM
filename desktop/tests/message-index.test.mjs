import test from 'node:test';
import assert from 'node:assert/strict';
import {updateMessageIndex} from '../src/store/messageIndex.ts';

const row=(id,chatId,sentAt=id)=>({id,chatId,sentAt});
test('ACK plus appended messages only replace the affected conversation buckets',()=>{
 const messages=Array.from({length:10000},(_,i)=>row(String(i).padStart(6,'0'),'chat-'+i%1000));
 const index=updateMessageIndex(messages,{});
 const next=[...messages];next[5500]={...next[5500],deliveryStatus:'read'};next.push(row('999999','chat-2'));
 const updated=updateMessageIndex(next,index);
 for(const id of Object.keys(index))assert.equal(updated[id]===index[id],!['chat-500','chat-2'].includes(id),id);
 assert.equal(updated['chat-500'].find(m=>m.id===next[5500].id).deliveryStatus,'read');
 assert.equal(updated['chat-2'].at(-1).id,'999999');
 assert.equal(updateMessageIndex([...next],updated),updated);
});

test('history prepend, deletion, chat reassignment and emptying match a complete chronological index',()=>{
 let messages=[row('b','a'),row('d','a'),row('c','b')];let index=updateMessageIndex(messages,{});
 for(const next of [[row('a','a'),...messages],[messages[0],messages[2]],[{...messages[0],chatId:'b'},messages[2]],[]]){
  const expected={};for(const m of next)(expected[m.chatId]??=[]).push(m);
  for(const bucket of Object.values(expected))bucket.sort((a,b)=>a.sentAt.localeCompare(b.sentAt));
  index=updateMessageIndex(next,index);assert.deepEqual(index,expected);
 }
});

test('imported chat IDs cannot change the index object prototype',()=>{
 const message=row('one','__proto__');const index=updateMessageIndex([message],{});
 assert.deepEqual(index.__proto__,[message]);assert.equal(Object.getPrototypeOf(index),Object.prototype);
});
