import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';

const mocks={
 '@/lib/bridge':'export const isTauri=()=>true;',
 '@/lib/idb':'export const clearAppState=async()=>{},idbDelPrefix=async()=>{},loadAppState=async()=>null,saveAppState=async()=>{};',
 '@/lib/mediaCache':'export const clearMediaCache=async()=>{};',
 '@tauri-apps/api/core':'export const invoke=(command,args)=>globalThis.folderInboundNative(command,args);',
};
const built=await build({stdin:{contents:"export * from './src/lib/folderUnreplied.ts';export {findChatsWithInbound} from './src/lib/storage.ts';",resolveDir:fileURLToPath(new URL('../',import.meta.url))},bundle:true,write:false,format:'esm',platform:'node',alias:{'@':fileURLToPath(new URL('../src',import.meta.url))},plugins:[{name:'storage-boundary',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
const {folderPhoneCandidates,neverRepliedPhones,copyNeverRepliedFolderNumbers,findChatsWithInbound}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text+'\n//# sourceURL=folder-unreplied-tests.js').toString('base64'));
const phone=n=>`+12025550${String(n).padStart(3,'0')}`;
function fixture(){
 const contacts=Array.from({length:8},(_,i)=>({id:'c'+i,name:'Person '+i,phone:phone(i),accountId:'a'}));
 const chats=contacts.map(c=>({id:c.id,contactId:c.id,accountId:'a',lastMessage:''}));
 return {contacts,chats,messages:[],hydrated:true,uiReady:true,settings:{liveBaileysAccountId:'a',activeAccountId:'a',chatFolders:[{id:'folder',scope:{type:'account',accountId:'a'},chatIds:chats.slice(0,6).map(c=>c.id)},{id:'child',parentId:'folder',scope:{type:'account',accountId:'a'},chatIds:['c6']}],chatFolderClones:[{id:'clone',folderId:'folder',sourceChatId:'c7'}]}};
}
const inbound=(id,extra={})=>({id:'m-'+id,chatId:id,accountId:'a',direction:'in',body:'reply',...extra});

test('only the current folder and its explicit clones are candidates; groups, notes and non-phone identities are excluded',()=>{
 const state=fixture();
 for(const [id,extra,chatExtra]of [['group',{isGroup:true,phone:phone(10)},{}],['note',{phone:phone(11)},{localOnly:true}],['lid',{phone:'',channelAddress:'123456789012345@lid'},{}],['invalid',{phone:'customer 123456789'},{}]]){
  state.contacts.push({id,...extra,accountId:'a'});state.chats.push({id,contactId:id,accountId:'a',...chatExtra});state.settings.chatFolders[0].chatIds.push(id);
 }
 assert.deepEqual(folderPhoneCandidates(state,'folder').map(c=>c.phone),[0,1,2,3,4,5,7].map(phone));
 assert.throws(()=>folderPhoneCandidates(state,'missing'),/folderMissing/);
});

test('outgoing messages and read receipts do not count, while any old inbound text or media excludes a number',()=>{
 const state=fixture(),candidates=folderPhoneCandidates(state,'folder');
 const messages=[
  inbound('c1',{direction:'out',deliveryStatus:'read',quoted:{fromMe:false}}),
  inbound('c2',{sentAt:'2000-01-01'}),inbound('c2',{direction:'out',sentAt:'2026-11-02'}),
  inbound('c3',{body:'',mediaType:'audio',mediaPending:true}),inbound('c4',{body:'',mediaType:'image'}),
  inbound('c5',{mediaType:'system'}),inbound('c5',{systemKind:'call'}),
 ];
 assert.deepEqual(neverRepliedPhones(candidates,messages,[]),[0,1,5,7].map(phone));
});

test('same-number aliases outside the folder are checked, numbers are normalized and duplicate members are copied once',()=>{
 const state=fixture();
 state.contacts.push({id:'alias-contact',phone:'+1 (202) 555-0000',accountId:'a'});
 state.chats.push({id:'alias',contactId:'alias-contact',accountId:'a'});
 state.settings.chatFolders[0].chatIds.push('c0');
 const candidates=folderPhoneCandidates(state,'folder');
 assert.equal(candidates.filter(c=>c.phone===phone(0)).length,1);
 assert.deepEqual(candidates.find(c=>c.phone===phone(0)).chats.map(c=>c.id),['c0','alias']);
 assert.equal(neverRepliedPhones(candidates,[],['alias']).includes(phone(0)),false,'cold reply under another local chat ID must exclude the same number');
});

test('account folders stay isolated; all-account folders exclude a person who replied on another account',()=>{
 const state=fixture();state.contacts.push({id:'b',phone:phone(0),accountId:'b'});state.chats.push({id:'b-chat',contactId:'b',accountId:'b'});
 const messages=[inbound('b-chat',{accountId:'b'}),inbound('c1',{accountId:'b'}),inbound('c5',{accountId:undefined,deviceId:'b'})];
 assert.ok(neverRepliedPhones(folderPhoneCandidates(state,'folder'),messages,[]).includes(phone(0)));
 assert.ok(neverRepliedPhones(folderPhoneCandidates(state,'folder'),messages,[]).includes(phone(1)));
 assert.ok(neverRepliedPhones(folderPhoneCandidates(state,'folder'),messages,[]).includes(phone(5)));
 state.settings.chatFolders[0].scope={type:'all'};
 assert.equal(neverRepliedPhones(folderPhoneCandidates(state,'folder'),messages,[]).includes(phone(0)),false);
});

test('copy waits for persistence and full history, rechecks new arrivals, and writes one unique number per line',async()=>{
 const state=fixture(),events=[];let text;
 const count=await copyNeverRepliedFolderNumbers('folder',{
  getState:()=>state,flush:async()=>events.push('flush'),
  findInbound:async ids=>{events.push('query');assert.ok(ids.includes('c7'));assert.ok(!ids.includes('c6'));state.messages.push(inbound('c1'));return ['c0'];},
  writeText:async value=>{events.push('copy');text=value;},
 });
 assert.deepEqual(events,['flush','query','copy']);assert.equal(count,5);assert.equal(text,[2,3,4,5,7].map(phone).join('\n'));
});

test('no matches, storage errors, folder changes and restore races never overwrite the clipboard',async()=>{
 for(const scenario of ['none','flush-failed','query-failed','folder-changed','not-ready','restore-race']){
  const state=fixture();let copies=0;
  const operation=copyNeverRepliedFolderNumbers('folder',{
   getState:()=>state,
   flush:async()=>{if(scenario==='flush-failed')throw Error('disk failure');},
   findInbound:async ids=>{
    if(scenario==='query-failed')throw Error('database error');
    if(scenario==='folder-changed')state.settings.chatFolders[0].chatIds=[];
    if(scenario==='not-ready'||scenario==='restore-race')state.uiReady=false;
    return scenario==='none'?ids:[];
   },writeText:async()=>copies++,
  });
  if(scenario==='none')assert.equal(await operation,0);else await assert.rejects(operation);
  assert.equal(copies,0,scenario);
 }
 const state=fixture();state.uiReady=false;
 await assert.rejects(copyNeverRepliedFolderNumbers('folder',{getState:()=>state,flush:async()=>assert.fail('must not flush'),findInbound:async()=>[],writeText:async()=>assert.fail('must not copy')}),/Not ready/);
 await assert.rejects(copyNeverRepliedFolderNumbers('folder',{getState:()=>fixture(),flush:async()=>{},findInbound:async()=>[],writeText:async()=>{throw Error('clipboard denied');}}),/clipboard denied/);
});

test('SQLite lookup errors and malformed responses stay errors, never an empty-history fallback',async()=>{
 let result=['chat'],failure=false;const calls=[];
 globalThis.folderInboundNative=async(command,args)=>{calls.push([command,args]);if(command==='db_info')return {engine:'sqlite'};if(failure)throw Error('database unavailable');return result;};
 assert.deepEqual(await findChatsWithInbound(['chat']),['chat']);assert.equal(calls.at(-1)[0],'db_chats_with_inbound');assert.deepEqual(calls.at(-1)[1],{chatIds:['chat']});
 result=['unexpected'];await assert.rejects(findChatsWithInbound(['chat']),/Invalid inbound/);
 result=null;await assert.rejects(findChatsWithInbound(['chat']),/Invalid inbound/);
 failure=true;await assert.rejects(findChatsWithInbound(['chat']),/database unavailable/);
 assert.deepEqual(await findChatsWithInbound([]),[]);
});
