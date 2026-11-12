import test from 'node:test';
import assert from 'node:assert/strict';
import {createMuseChatRedactor, museChatMessages} from '../src/lib/museChatPrivacy.ts';

test('chat text hides known identities, contact links, email and formatted phones, while retaining dates and short quantities',()=>{
  const redact=createMuseChatRedactor([{name:'Élodie Dupont',phone:'+33612345678'},{label:'1: Alexandre',userName:'Alex',phoneE164:'+12025550101'}]);
  const output=redact('Élodie Dupont / Alexandre / Alex : +33 (6) 12 34 56 78, 243812345678, user@example.com. Rendez-vous 2026-11-12 à 17:30, 2 places pour 150 euros.');
  assert.doesNotMatch(output,/Élodie|Dupont|Alex|336|243812345678|user@example/);
  assert.match(output,/2026-11-12 à 17:30, 2 places pour 150 euros/);
  assert.match(redact('unrelated Alexandra'),/Alexandra/);
  assert.equal(redact('12.11.2026'),'12.11.2026');
  assert.equal(redact('+33612345678 243812345678'),'[phone omitted]');
  assert.equal(redact('1. Unknown Name https://wa.me/243812345678'),'[shared contact omitted]');
  assert.equal(redact('BEGIN:VCARD\nFN:Unknown Person\nTEL:+33612345678\nEND:VCARD'),'[shared contact omitted]');
  assert.equal(redact('BEGIN:VCARD\nFN:Unknown Person'),'[shared contact omitted]');
});

test('quoted sender names and JSON-escaped names are redacted without exposing a directory',()=>{
  const redact=createMuseChatRedactor([{name:'Alice "private" Example'}],[{senderName:'王小明',quoted:{senderName:'Benoît'}}]);
  const text=redact(JSON.stringify({text:'Alice "private" Example / 你好王小明请明天来 / Benoît'}));
  assert.doesNotMatch(text,/Alice|private|Example|王小明|Benoît/);
  assert.doesNotThrow(()=>JSON.parse(text));
});

test('only the current account and chat may supply messages',()=>{
  const messages=[{id:'current',chatId:'chat',accountId:'a'},{id:'legacy',chatId:'chat'},
    {id:'other-chat',chatId:'other',accountId:'a'},{id:'other-account',chatId:'chat',accountId:'b'},
    {id:'other-device',chatId:'chat',deviceId:'b'}];
  assert.deepEqual(museChatMessages(messages,'chat','a').map(item=>item.id),['current','legacy']);
});

test('large directories reuse rules and invalidate on identity changes',()=>{
 const identities=Array.from({length:5000},(_,i)=>({name:'Contact person '+i}));
 const first=createMuseChatRedactor(identities);
 assert.equal(createMuseChatRedactor(identities),first);
 assert.equal(first('Contact person 4999 / unrelated'), '[person omitted] / unrelated');
 identities[0].name='New Private Identity';
 const next=createMuseChatRedactor(identities);assert.notEqual(next,first);
 assert.equal(next('New Private Identity'),'[person omitted]');
});
