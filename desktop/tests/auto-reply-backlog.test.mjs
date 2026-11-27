import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const mocks = {
  '@/store/appStore': `export const useAppStore={getState:()=>globalThis.backlog.state,setState:fn=>{const s=globalThis.backlog.state;Object.assign(s,fn(s));s.messagesByChatId={};}};`,
  './aiAutoReply': `export function scheduleAutoReplyInbound(message){globalThis.backlog.scheduled.push(message);globalThis.backlog.onSchedule?.(message);}`,
  './storage': `export const loadMessagesPage=opts=>globalThis.backlog.loadPage(opts);`,
};
const built = await build({ stdin: { contents: `export * from './src/lib/aiAutoReplyBacklog';
export {useAutoReplyRuntime} from './src/lib/autoReplyRuntime';
export {beginDataRestore} from './src/store/restoreGuard';
export {setAppLockActive} from './src/lib/appLockRuntime';`, resolveDir: root }, bundle: true, write: false, format: 'esm', platform: 'node', alias: {'@':root+'src'}, plugins: [{name:'backlog-boundaries', setup(b){
  b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);
  b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));
}}] });
const {createAutoReplyBacklogScheduler,useAutoReplyRuntime,beginDataRestore,setAppLockActive} = await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
function setup(t) {
  const inbound = {id:'in',chatId:'chat',contactId:'contact',accountId:'account',direction:'in',body:'Bonjour',sentAt:'2026-11-10T10:00:00Z'};
  const manual = {aiReplyMode:'semi',chatFolders:[{id:'folder',name:'Folder',chatIds:['chat'],autoReplyMode:'manual'}],chatFolderClones:[]};
  const settings = {...manual,chatFolders:[{...manual.chatFolders[0],autoReplyMode:'auto'}]};
  const state = {hydrated:true,settings,messages:[inbound],messagesByChatId:{},contacts:[{id:'contact',accountId:'account'}],chats:[{id:'chat',contactId:'contact',accountId:'account',unread:0,lastMessageDirection:'in',replyPendingSince:inbound.sentAt}],pushToast(){globalThis.backlog.errors++;}};
  globalThis.backlog={state,scheduled:[],errors:0,loadPage:async()=>({items:[]})};
  useAutoReplyRuntime.setState({byChat:{}});setAppLockActive(false);
  const scheduler=createAutoReplyBacklogScheduler();
  t.after(()=>{scheduler.stop();setAppLockActive(false);useAutoReplyRuntime.setState({byChat:{}});delete globalThis.backlog;});
  return {scheduler,state,inbound,manual};
}

test('enabling a folder replies only to the newest unanswered inbound, including already read messages',async t=>{
  const {scheduler,state,inbound,manual}=setup(t);
  state.messages.unshift({...inbound,id:'older',sentAt:'2026-11-09T10:00:00Z'});
  await scheduler.schedule(manual);
  assert.deepEqual(globalThis.backlog.scheduled.map(m=>m.id),['in']);
  await scheduler.schedule(state.settings);
  assert.equal(globalThis.backlog.scheduled.length,1,'unchanged auto mode must not replay the backlog');
});

for(const kind of ['manual chat','manual parent','paused','handled','archived','group','local','stopped','manual reply','queued reply','uncertain reply','failed task','active task','foreign account'])test(`backlog skips ${kind}`,async t=>{
  const {scheduler,state,inbound,manual}=setup(t);
  if(kind==='manual chat')state.settings.aiAutoReplyModeByChatId={chat:'manual'};
  if(kind==='manual parent')state.settings.chatFolders=[{...manual.chatFolders[0],autoReplyMode:'manual'}];
  if(kind==='paused')state.settings.aiAutoReplyPaused=true;
  if(kind==='handled')state.chats[0].replyHandledAt='2026-11-11T00:00:00Z';
  if(kind==='archived')state.chats[0].archived=true;
  if(kind==='group')state.chats[0].isGroup=true;
  if(kind==='local')state.chats[0].localOnly=true;
  if(kind==='stopped')state.settings.aiTaskDismissedIds=['runtime:chat:in'];
  if(kind==='manual reply')state.messages.push({...inbound,id:'out',direction:'out',sentAt:'2026-11-10T11:00:00Z'});
  if(['queued reply','uncertain reply','failed task'].includes(kind))state.messages.push({...inbound,id:'auto',direction:'out',systemKind:'ai_auto_reply',aiReplyInboundId:'in',deliveryStatus:kind==='queued reply'?'queued':'failed',deliveryUncertain:kind==='uncertain reply',sentAt:'2026-11-10T11:00:00Z'});
  if(kind==='active task')useAutoReplyRuntime.setState({byChat:{chat:{phase:'generating',inboundId:'in'}}});
  if(kind==='foreign account')inbound.accountId='other-account';
  await scheduler.schedule(manual);
  assert.equal(globalThis.backlog.scheduled.length,0);
});

test('parent folder inheritance and global resume include newly automatic chats',async t=>{
  const {scheduler,state,manual}=setup(t);
  state.settings.chatFolders=[{id:'parent',name:'Parent',chatIds:[],autoReplyMode:'auto'},{id:'folder',name:'Child',parentId:'parent',chatIds:['chat']}];
  await scheduler.schedule(manual);assert.equal(globalThis.backlog.scheduled.length,1);
  await scheduler.schedule({...state.settings,aiAutoReplyPaused:true});assert.equal(globalThis.backlog.scheduled.length,2);
});

test('loads cold history before scheduling and retains newer in-memory replies',async t=>{
  const {scheduler,state,inbound,manual}=setup(t);state.messages=[];state.chats[0].hasMessageHistory=true;
  globalThis.backlog.loadPage=async opts=>{assert.equal(opts.limit,80);assert.equal(opts.chatId,'chat');return {items:[inbound]};};
  await scheduler.schedule(manual);assert.equal(globalThis.backlog.scheduled[0].id,'in');
  globalThis.backlog.scheduled=[];
  state.messages.push({...inbound,id:'answered',direction:'out',sentAt:'2026-11-11T00:00:00Z'});
  await scheduler.schedule(manual);assert.equal(globalThis.backlog.scheduled.length,0);
});

test('walks several cold history pages past system messages and schedules the latest real inbound',async t=>{
  const {scheduler,state,inbound,manual}=setup(t);
  state.messages=[];
  state.chats[0].hasMessageHistory=true;
  const pages=Array.from({length:3},(_,page)=>Array.from({length:80},(_,i)=>({
    ...inbound,id:`system-${page}-${i}`,mediaType:'system',direction:'out',
    sentAt:new Date(Date.parse(inbound.sentAt)+(240-page*80+i)*1000).toISOString(),
  })));
  const calls=[];
  globalThis.backlog.loadPage=async opts=>{
    if(calls.length) assert.equal(opts.beforeId,pages[calls.length-1][0].id);
    const items=pages[calls.length]||[inbound];
    calls.push(opts);
    return {items,limit:80};
  };
  await scheduler.schedule(manual);
  assert.equal(calls.length,4);
  assert.deepEqual(globalThis.backlog.scheduled.map(message=>message.id),['in']);
});

for(const change of ['manual reply','handled','disabled','paused','deleted','account changed','contact changed','restore','locked','stopped','live task'])test(`revalidates after reading cold history when ${change}`,async t=>{
  const {scheduler,state,inbound,manual}=setup(t);state.messages=[];state.chats[0].hasMessageHistory=true;
  let release;globalThis.backlog.loadPage=()=>new Promise(resolve=>{release=resolve;});
  const loading=scheduler.schedule(manual);
  if(change==='manual reply')state.messages.push({...inbound,id:'manual',direction:'out',sentAt:'2026-11-11T00:00:00Z'});
  if(change==='handled')state.chats[0].replyHandledAt='2026-11-11T00:00:00Z';
  if(change==='disabled')state.settings=manual;
  if(change==='paused')state.settings.aiAutoReplyPaused=true;
  if(change==='deleted')state.chats=[];
  if(change==='account changed')state.chats[0]={...state.chats[0],accountId:'other'};
  if(change==='contact changed')state.chats[0]={...state.chats[0],contactId:'other'};
  if(change==='restore'){const finish=beginDataRestore();finish();}
  if(change==='locked')setAppLockActive(true);
  if(change==='stopped')scheduler.stop();
  if(change==='live task')useAutoReplyRuntime.setState({byChat:{chat:{phase:'waiting',inboundId:'new'}}});
  release({items:[inbound]});await loading;
  assert.equal(globalThis.backlog.scheduled.length,0);
});

test('overlapping toggles share the pending history read and failures never generate from partial history',async t=>{
  const {scheduler,state,manual}=setup(t);state.messages=[];state.chats[0].hasMessageHistory=true;
  let release,calls=0;globalThis.backlog.loadPage=()=>{calls++;return new Promise((_resolve,reject)=>{release=reject;});};
  const loading=scheduler.schedule(manual);await scheduler.schedule(manual);assert.equal(calls,1);
  release(new Error('disk unavailable'));await loading;
  assert.equal(globalThis.backlog.scheduled.length,0);assert.equal(globalThis.backlog.errors,1);
});
