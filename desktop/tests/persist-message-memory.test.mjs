import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {fileURLToPath} from 'node:url';
const mocks={
 '@/lib/storage':`export const getStorageEngine=()=> 'sqlite';export const canPersistRowDeltas=()=>true;export const saveAppState=async value=>{globalThis.memoryWrites.push(value);};`,
 '@/lib/composerActivity':'export const isComposerTypingBusy=()=>false;',
 '@/lib/syncDebug':'export const noteMainThreadWork=()=>{};',
};
const b=await build({entryPoints:[fileURLToPath(new URL('../src/store/persist.ts',import.meta.url))],bundle:true,write:false,format:'esm',platform:'node',alias:{'@':fileURLToPath(new URL('../src',import.meta.url))},plugins:[{name:'memory-checkpoint',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
const {flushPersist,prunePersistedMessageMemory}=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
test('evicting durable cold history never becomes a SQLite message deletion',async()=>{
 globalThis.memoryWrites=[];let state={hydrated:true,selectedChatId:'active',messages:Array.from({length:45000},(_,i)=>({id:String(i),chatId:'cold',direction:'in',sentAt:new Date(1700000000000+i).toISOString(),body:'history'})),phones:[],contacts:[],chats:[],followUps:[],activities:[],settings:{},draftReplyByChatId:{},broadcastCampaigns:[]};
 const get=()=>state,set=p=>state={...state,...p};
 prunePersistedMessageMemory(get,set);assert.equal(state.messages.length,45000,'unsaved history cannot be evicted');
 await flushPersist(get);prunePersistedMessageMemory(get,set);assert.equal(state.messages.length,20000);
 state={...state,messages:[...state.messages,{id:'new',chatId:'active',direction:'in',body:'live',sentAt:new Date().toISOString()}]};
 await flushPersist(get);const write=globalThis.memoryWrites.at(-1);
 assert.deepEqual(write.deletedMessageIds,[]);assert.deepEqual(write.messages.map(m=>m.id),['new']);
});
