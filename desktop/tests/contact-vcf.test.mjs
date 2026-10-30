import assert from 'node:assert/strict';
import test from 'node:test';
import { buildContactsVcf, MAX_VCF_CONTACTS, MAX_VCF_TEXT_LENGTH, parseVcfContacts, vcfContactName } from '../src/lib/contactVcf.ts';
const rule={prefix:'',suffix:'',lastFour:false};

test('pasted names with spaces and accents retain their names and international numbers',()=>{
 const result=parseVcfContacts('Jean Exemple\t12025550101\r\nNathalie Mère Exemple\t12025550102\r\nbedline exemple 12025550103');
 assert.deepEqual(result.issues,[]);assert.equal(result.duplicates,0);
 assert.deepEqual(result.contacts,[{name:'Jean Exemple',phone:'+12025550101'},{name:'Nathalie Mère Exemple',phone:'+12025550102'},{name:'bedline exemple',phone:'+12025550103'}]);
 const content=buildContactsVcf(result.contacts,{prefix:'10/30',suffix:'Groupe',lastFour:true});
 assert.equal((content.match(/BEGIN:VCARD/g)||[]).length,3);
 assert.match(content,/FN:10\/30 Nathalie Mère Exemple Groupe 0102\r\n/);
 assert.match(content,/N:;10\/30 Jean Exemple Groupe 0101;;;/);
 assert.match(content,/TEL;TYPE=CELL:\+12025550103/);assert.ok(content.endsWith('END:VCARD\r\n'));
 assert.equal(vcfContactName(result.contacts[0],rule),'Jean Exemple');
});

test('CSV, header rows, formatted phones and whitespace work without losing numeric parts of names',()=>{
 const cases=[
  ['Name,Phone\n"Doe, Example",+12025550101','Doe, Example'],
  ['"Doe; Example",+12025550101','Doe; Example'],
  ['"Doe, Example";+12025550101','Doe, Example'],
  ['Nom;Téléphone\nNathalie Exemple;0012025550101','Nathalie Exemple'],
  ['姓名\t号码\n测试联系人\t+1 (202) 555-0101','测试联系人'],
  ['Agent 2 12025550101','Agent 2'],
  ['Agent 2 +1 202 555 0101','Agent 2'],
  ['Example\t\'12025550101\t','Example'],
 ];
 for(const [input,name] of cases){const result=parseVcfContacts(input);assert.deepEqual(result.issues,[],input);assert.deepEqual(result.contacts,[{name,phone:'+12025550101'}]);}
});

test('errors retain original line numbers and repeated numbers keep only the first name',()=>{
 const result=parseVcfContacts('\nFirst\t12025550101\nDuplicate\t+1 (202) 555-0101\nMissing phone\n\t12025550102\nBad\t0612345678\nWrong\t12025550103ext9\nExtra\t12025550104\tcolumn');
 assert.deepEqual(result.contacts,[{name:'First',phone:'+12025550101'}]);assert.equal(result.duplicates,1);
 assert.deepEqual(result.issues,[{line:4,kind:'format'},{line:5,kind:'name'},{line:6,kind:'phone'},{line:7,kind:'phone'},{line:8,kind:'format'}]);
 for(const phone of ['+0123456789','+123','+1234567890123456','+1 202 555 0101 ext 5']) assert.equal(parseVcfContacts(`Name\t${phone}`).contacts.length,0);
});

test('vCard text is escaped and long UTF-8 lines fold without corrupting names or injecting fields',()=>{
 const name='测试😀é'.repeat(25)+';Example,\\\nEND:VCARD\r\nBEGIN:VCARD';
 const content=buildContactsVcf([{name,phone:'+12025550101'}],{prefix:'Préfixe',suffix:'后缀',lastFour:true});
 for(const line of content.split('\r\n')) assert.ok(new TextEncoder().encode(line).length<=75);
 const unfolded=content.replace(/\r\n /g,'');
 assert.equal((unfolded.match(/(?:^|\r\n)BEGIN:VCARD/g)||[]).length,1);
 assert.equal((unfolded.match(/(?:^|\r\n)END:VCARD/g)||[]).length,1);
 assert.match(unfolded,/\\;Example\\,\\\\\\nEND:VCARD\\nBEGIN:VCARD/);
 assert.ok(!content.includes('\uFFFD'));
});

test('oversized batches and invalid builder input fail explicitly',()=>{
 const rows=Array.from({length:MAX_VCF_CONTACTS+1},(_,i)=>`Name ${i}\t${12025550000+i}`).join('\n');
 assert.ok(parseVcfContacts(rows).issues.some(issue=>issue.kind==='limit'));
 assert.equal(parseVcfContacts('x'.repeat(MAX_VCF_TEXT_LENGTH+1)).issues[0].kind,'limit');
 assert.throws(()=>buildContactsVcf([],rule));
 assert.throws(()=>buildContactsVcf([{name:'',phone:'+12025550101'}],rule));
 assert.throws(()=>buildContactsVcf([{name:'Name',phone:'12025550101'}],rule));
});
