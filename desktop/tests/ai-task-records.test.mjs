import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeAiReplyTaskRecords,updateAiReplyTaskRecords} from '../src/lib/aiTaskRecords.ts';

test('task failure reasons survive serialization without retaining conversation text',()=>{
 const task={phase:'human',inboundId:'in',accountId:'a',reason:'network timeout'};
 const records=updateAiReplyTaskRecords([],{chat:task},{},[]);
 assert.deepEqual(JSON.parse(JSON.stringify(normalizeAiReplyTaskRecords(JSON.parse(JSON.stringify(records))))),JSON.parse(JSON.stringify(records)));
 assert.equal(records[0].reason,'network timeout');assert.equal(records[0].id,'runtime:chat:in');
 assert.equal(records[0].body,undefined);
});
test('replacing a task ends only the old record and associates its exact outgoing reply',()=>{
 const old={phase:'generating',inboundId:'old'},next={phase:'waiting',inboundId:'new'};
 const records=updateAiReplyTaskRecords([],{chat:next},{chat:old},[{id:'out',chatId:'chat',systemKind:'ai_auto_reply',aiReplyInboundId:'old'}]);
 assert.equal(records.find(record=>record.inboundId==='old').phase,'ended');
 assert.equal(records.find(record=>record.inboundId==='old').messageId,'out');
 assert.equal(records.find(record=>record.inboundId==='new').phase,'waiting');
});
test('task record import rejects invalid dates, phases and oversized identifiers',()=>{
 const record={chatId:'c',inboundId:'i',at:new Date().toISOString(),phase:'waiting'};
 assert.equal(normalizeAiReplyTaskRecords([record,{...record,chatId:'bad',phase:'send-now'},{...record,chatId:'date',at:'invalid'},{...record,chatId:'x'.repeat(201)}]).length,1);
});
