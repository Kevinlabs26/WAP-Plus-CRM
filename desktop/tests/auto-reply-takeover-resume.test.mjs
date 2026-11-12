import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const mocks = {
  '@/store/appStore': 'export const useAppStore={getState:()=>globalThis.__takeoverTest.state};',
  '@/lib/utils': 'export const resolveSendTarget=()=>"12025550100";',
  '@/lib/aiSuggest': 'export const hasRealAiKey=()=>true; export const getSuggestionContextKey=()=>"context"; export async function generateSuggestions(){globalThis.__takeoverTest.generated++;if(globalThis.__takeoverTest.gate)await globalThis.__takeoverTest.gate;return {fallback:true,error:"test stops before sending"};}',
  '@/lib/aiSuggestionCache': 'export const isManualSuggestionContext=()=>false;export const SUGGESTION_MAX_AGE_MS=300000;',
  '@/lib/aiReplyContext': 'export const currentAutoReplyContext=()=>"context";export const hashAiReplyContext=async()=>"hash";',
  '@/components/chat/sendTextMessage': 'export const sendTextMessage=async()=>{throw Error("must not send in test");};',
  '@/lib/accountConnection': 'export const isWaAccountConnected=()=>true;',
  '@/components/chat/reloadMediaAction': 'export const reloadMedia=async()=>{};',
  '@/components/chat/resolveMessageKey': 'export const resolveMessageKeyFrom=()=>{};',
  '@/lib/transcribeVoice': 'export const transcribeVoice=async()=>{};',
};
const root=fileURLToPath(new URL('../',import.meta.url));
const built=await build({stdin:{contents:`export * from './src/lib/aiAutoReply.ts';export {useAutoReplyRuntime} from './src/lib/autoReplyRuntime.ts';`,resolveDir:root},bundle:true,write:false,format:'esm',platform:'node',alias:{'@':root+'src'},plugins:[{name:'takeover-boundaries',setup(b){
  b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);
  b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));
}}]});
const {autoReplyInbound,scheduleAutoReplyInbound,refreshManualTakeovers,refreshAutoReplyPause,stopAutoReplies,stopChatAutoReply,stopAutoReplyTask,retryAutoReplyTask,useAutoReplyRuntime}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const settle=async()=>{for(let i=0;i<3;i++)await new Promise(resolve=>setImmediate(resolve));};
function setup(t,minutes=1){
  t.mock.timers.enable({apis:['Date','setTimeout'],now:Date.parse('2026-11-12T12:00:00Z')});
  const manual={id:'manual',chatId:'chat',contactId:'contact',accountId:'account',direction:'out',body:'hello',sentAt:new Date(Date.now()-30000).toISOString()};
  const inbound={...manual,id:'inbound',direction:'in',body:'bonjour',sentAt:new Date().toISOString()};
  const state={settings:{aiReplyMode:'auto',sendChannel:'baileys',aiProvider:'muse',aiAutoReplyPolicy:{takeoverMinutes:minutes}},
    baileysUi:{connection:'connected'},messages:[manual,inbound],contacts:[{id:'contact',phone:'+12025550100'}],chats:[{id:'chat',contactId:'contact',accountId:'account'}],logActivity(){},
    updateSettings(patch){this.settings={...this.settings,...patch};},updateMessageDelivery(id,patch){this.messages=this.messages.map(message=>message.id===id?{...message,...patch}:message);}};
  globalThis.__takeoverTest={state,generated:0};
  t.after(()=>{stopAutoReplies();delete globalThis.__takeoverTest;});
  return {state,inbound};
}
test('manual pause expires and automatically rechecks the still-unanswered inbound',async t=>{
  const {inbound}=setup(t);
  await autoReplyInbound(inbound);
  assert.equal(globalThis.__takeoverTest.generated,0);
  assert.equal(useAutoReplyRuntime.getState().byChat.chat.phase,'waiting',JSON.stringify(useAutoReplyRuntime.getState().byChat.chat));
  assert.equal(useAutoReplyRuntime.getState().byChat.chat.retryAt,Date.now()+30000);
  t.mock.timers.tick(30000);await settle();
  assert.equal(globalThis.__takeoverTest.generated,1);
  t.mock.timers.tick(60000);await settle();assert.equal(globalThis.__takeoverTest.generated,1);
});
for(const kind of ['group-message','group-chat','group-contact','group-address','manual','local'])test(`ineligible ${kind} never creates an auto-reply task or starts generation`,async t=>{
  const {state,inbound}=setup(t);
  if(kind==='group-message')inbound.isGroup=true;
  if(kind==='group-chat')state.chats[0].isGroup=true;
  if(kind==='group-contact')state.contacts[0].isGroup=true;
  if(kind==='group-address')state.contacts[0].channelAddress='test@g.us';
  if(kind==='manual')state.settings.aiReplyMode='semi';
  if(kind==='local')state.chats[0].localOnly=true;
  if(kind==='paused')state.settings.aiAutoReplyPaused=true;
  scheduleAutoReplyInbound(inbound);
  assert.equal(useAutoReplyRuntime.getState().byChat.chat,undefined);
  await autoReplyInbound(inbound);t.mock.timers.tick(60000);await settle();
  assert.equal(globalThis.__takeoverTest.generated,0);assert.equal(useAutoReplyRuntime.getState().byChat.chat,undefined);
});
test('global pause retains only the newest inbound and resumes it after revalidation',async t=>{
  const {state,inbound}=setup(t);scheduleAutoReplyInbound(inbound);
  state.settings.aiAutoReplyPaused=true;refreshAutoReplyPause();
  t.mock.timers.tick(120000);await settle();assert.equal(globalThis.__takeoverTest.generated,0);
  const next={...inbound,id:'new',sentAt:new Date().toISOString()};state.messages.push(next);scheduleAutoReplyInbound(next);
  assert.equal(useAutoReplyRuntime.getState().byChat.chat.inboundId,'new');
  state.settings.aiAutoReplyPaused=false;refreshAutoReplyPause();t.mock.timers.tick(1200);await settle();
  assert.equal(globalThis.__takeoverTest.generated,1);
});
test('a manual reply during global pause prevents a late automatic reply',async t=>{
  const {state,inbound}=setup(t);state.settings.aiAutoReplyPaused=true;scheduleAutoReplyInbound(inbound);
  t.mock.timers.tick(120000);state.messages.push({...inbound,id:'manual-after',direction:'out',sentAt:new Date().toISOString()});
  state.settings.aiAutoReplyPaused=false;refreshAutoReplyPause();t.mock.timers.tick(1200);await settle();assert.equal(globalThis.__takeoverTest.generated,0);
});
test('stopping or retrying an old task does not cancel the newer task or its outgoing message',async t=>{
  const {state,inbound}=setup(t);t.mock.timers.tick(60000);
  const next={...inbound,id:'new',sentAt:new Date().toISOString()};state.messages.push(next);scheduleAutoReplyInbound(next);
  state.messages.push({...inbound,id:'old-out',direction:'out',systemKind:'ai_auto_reply',deliveryStatus:'failed',aiReplyInboundId:inbound.id});
  state.messages.push({...next,id:'new-out',direction:'out',systemKind:'ai_auto_reply',deliveryStatus:'queued',aiReplyInboundId:next.id});
  assert.equal(await retryAutoReplyTask('chat',inbound.id,'old-out',true),false);
  stopAutoReplyTask('chat',inbound.id,'old-out');
  assert.equal(useAutoReplyRuntime.getState().byChat.chat.inboundId,'new');
  assert.equal(state.messages.find(message=>message.id==='new-out').deliveryStatus,'queued');
  assert.ok(!state.settings.aiTaskDismissedIds.includes('runtime:chat:new'));
});
test('resuming while an aborted generation is still settling cannot lose the pending task',async t=>{
  const {state,inbound}=setup(t);t.mock.timers.tick(60000);
  let release;globalThis.__takeoverTest.gate=new Promise(resolve=>{release=resolve;});
  const running=autoReplyInbound(inbound);await settle();assert.equal(globalThis.__takeoverTest.generated,1);
  state.settings.aiAutoReplyPaused=true;refreshAutoReplyPause();
  state.settings.aiAutoReplyPaused=false;refreshAutoReplyPause();t.mock.timers.tick(1200);await settle();
  globalThis.__takeoverTest.gate=undefined;release();await running;await settle();
  assert.equal(globalThis.__takeoverTest.generated,2);
});
test('retry sending reuses only the selected failed message and does not call AI again',async t=>{
  const {state,inbound}=setup(t);state.messages=state.messages.filter(message=>message.direction==='in');
  state.messages.push({...inbound,id:'failed-out',direction:'out',body:'Bonjour',systemKind:'ai_auto_reply',deliveryStatus:'failed',aiReplyContextHash:'hash',aiReplyInboundId:inbound.id});
  assert.equal(await retryAutoReplyTask('chat',inbound.id,'failed-out'),true);
  assert.equal(state.messages.find(message=>message.id==='failed-out').deliveryStatus,'queued');
  assert.equal(globalThis.__takeoverTest.generated,0);
  state.messages.find(message=>message.id==='failed-out').deliveryStatus='failed';state.messages.find(message=>message.id==='failed-out').deliveryUncertain=true;
  assert.equal(await retryAutoReplyTask('chat',inbound.id,'failed-out'),false);
});
test('shortening the policy immediately recalculates a pending pause',async t=>{
  const {state,inbound}=setup(t,5);await autoReplyInbound(inbound);
  t.mock.timers.tick(60000);
  state.settings.aiAutoReplyPolicy={takeoverMinutes:1};refreshManualTakeovers();await settle();
  assert.equal(globalThis.__takeoverTest.generated,1);
  t.mock.timers.tick(300000);await settle();assert.equal(globalThis.__takeoverTest.generated,1);
});
for(const change of ['manual reply','new inbound','disabled'])test(`pause recovery does not generate after ${change}`,async t=>{
  const {state,inbound}=setup(t);await autoReplyInbound(inbound);
  if(change==='disabled')state.settings.aiReplyMode='semi';
  else state.messages.push({...inbound,id:'new',direction:change==='manual reply'?'out':'in',sentAt:new Date(Date.now()+1000).toISOString()});
  t.mock.timers.tick(30000);await settle();assert.equal(globalThis.__takeoverTest.generated,0);
});
test('stopping automation cancels pending takeover recovery',async t=>{
  const {inbound}=setup(t);await autoReplyInbound(inbound);stopAutoReplies();
  t.mock.timers.tick(30000);await settle();assert.equal(globalThis.__takeoverTest.generated,0);
});
test('stopping one task suppresses that inbound and its timers, but permits the next inbound',async t=>{
  const {state,inbound}=setup(t);await autoReplyInbound(inbound);stopChatAutoReply('chat');
  t.mock.timers.tick(60000);await settle();await autoReplyInbound(inbound);
  assert.equal(globalThis.__takeoverTest.generated,0);
  const next={...inbound,id:'new',sentAt:new Date().toISOString()};state.messages.push(next);
  await autoReplyInbound(next);assert.equal(globalThis.__takeoverTest.generated,1);
});
test('stopping a chat cancels pending deliveries without rewriting delivered or uncertain messages',t=>{
  const {state,inbound}=setup(t);
  state.messages.push(...['queued','sent','failed'].map((deliveryStatus,index)=>({...inbound,id:'out-'+index,direction:'out',systemKind:'ai_auto_reply',deliveryStatus,...(index===2?{deliveryUncertain:true}:{})})));
  stopChatAutoReply('chat');
  assert.equal(state.messages.find(message=>message.id==='out-0').deliveryStatus,'failed');
  assert.equal(state.messages.find(message=>message.id==='out-1').deliveryStatus,'sent');
  assert.equal(state.messages.find(message=>message.id==='out-2').deliveryUncertain,true);
});
