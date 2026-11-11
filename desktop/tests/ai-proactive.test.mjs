import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const mocks={
 react:'export const useRef=current=>({current});export const useEffect=fn=>{globalThis.outreachQueueCleanup=fn();};',
 '@/channels':'export const normalizeChannelId=id=>id;export const dispatchSendText=async(request,runtime)=>{if(globalThis.outreachBeforeTransport)await globalThis.outreachBeforeTransport();if(!runtime.canSend())return {ok:false,error:"automation_cancelled"};globalThis.outreachSent.push({request,gap:runtime.requiredMinGapSec});return {ok:true};};',
 '@/i18n':'export const translateCurrent=(key)=>key;',
 '@/store/appStore':`export const useAppStore=selector=>selector(globalThis.outreachState);useAppStore.getState=()=>globalThis.outreachState;useAppStore.setState=patch=>globalThis.outreachPatch(patch);export const flushPersist=async()=>{if(globalThis.outreachDiskError)throw Error('disk full');globalThis.outreachCheckpoints.push(structuredClone({runs:outreachState.settings.aiOutreachRuns,messages:outreachState.messages}));};`,
 '@/lib/storage':'export const loadMessagesPage=async()=>({items:globalThis.outreachHistoryItems||[]});',
 '@/store/restoreGuard':'export const isDataRestoreActive=()=>false;export const getDataRestoreGeneration=()=>globalThis.outreachRestoreEpoch||0;',
};
const result=await build({stdin:{contents:`export * from './src/lib/aiOutreach.ts';export * from './src/lib/aiOutreachContext.ts';export * from './src/lib/aiOutreachRules.ts';export * from './src/lib/aiOutreachPreview.ts';export * from './src/lib/aiReplyStatus.ts';export {SendQueueWatcher} from './src/components/bridge/SendQueueWatcher.tsx';export {normalizeLoadedSettings} from './src/store/settingsDefaults.ts';export {buildSettingsSafe,parseBackupJson} from './src/lib/exportData.ts';`,resolveDir:root},bundle:true,write:false,format:'esm',platform:'node',alias:{'@':root+'src'},plugins:[{name:'outreach-boundaries',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
let sequence=0;
async function fixture(mode='auto',trigger='new'){
 const api=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text+'\n//# sourceURL=ai-proactive-fixture-'+sequence+++'.js').toString('base64'));
 const original={now:Date.now,fetch:globalThis.fetch,window:globalThis.window};let now=Date.parse('2026-11-06T09:15:00Z'),calls=0,fetchGate,networkFailure=false;
 Date.now=()=>now;globalThis.outreachDiskError=false;globalThis.outreachCheckpoints=[];
 globalThis.outreachRestoreEpoch=0;
 globalThis.outreachSent=[];globalThis.outreachBeforeTransport=undefined;globalThis.window={setInterval(){return 1;},clearInterval(){},setTimeout(){return 1;}};
 globalThis.outreachHistoryItems=[];
 globalThis.outreachPatch=patch=>{outreachState={...outreachState,...(typeof patch==='function'?patch(outreachState):patch)};outreachState.messagesByChatId=Object.fromEntries(outreachState.chats.map(chat=>[chat.id,outreachState.messages.filter(message=>message.chatId===chat.id)]));};
 globalThis.fetch=async()=>{calls++;if(fetchGate)await fetchGate;if(networkFailure)return Response.json({error:{message:'network failure'}},{status:503});return Response.json({choices:[{message:{content:'[{"text":"Bonjour, comment allez-vous ?"}]'}}]});};
 const settings=api.normalizeLoadedSettings({sendChannel:'baileys',aiProvider:'custom',customAiKey:'fixture',customAiModel:'fixture',customAiBaseUrl:'https://example.invalid',aiSystemPrompt:'Be brief and warm.',aiReplyMode:'semi',activeAccountId:'b',liveBaileysAccountId:'b',waAccounts:[{id:'a',label:'A',status:'connected'},{id:'b',label:'B',status:'connected'}],chatFolders:[{id:'folder',name:'Folder',sort:0,chatIds:['chat'],scope:{type:'account',accountId:'a'},aiOutreach:{enabled:true,mode,trigger,time:'09:00',timeZone:'UTC',dailyLimit:10,minIdleHours:12,goal:'Ask how the person is doing.'}}]});
 globalThis.outreachState={settings,hydrated:true,uiReady:true,baileysUi:{connection:'connected'},draftReply:'UNSENT HUMAN DRAFT',messages:[],messagesByChatId:{},
  contacts:[{id:'person',name:'Person',phone:'+12025550101',accountId:'a',tags:[],stage:'new'}],
  chats:[{id:'chat',contactId:'person',accountId:'a',phoneId:'a',contactName:'Person',updatedAt:'2026-11-05T12:00:00.000Z',lastMessage:'',hasMessageHistory:false,hasOutgoingHistory:false}],
  updateSettings(patch){outreachState={...outreachState,settings:{...outreachState.settings,...patch}};},
  enqueueOutgoingMessage(input){const message={id:'out-'+outreachState.messages.length,direction:'out',sentAt:new Date(now).toISOString(),...input};outreachState={...outreachState,messages:[...outreachState.messages,message],messagesByChatId:{...outreachState.messagesByChatId,[input.chatId]:[...(outreachState.messagesByChatId[input.chatId]||[]),message]},draftReply:'',chats:outreachState.chats.map(chat=>chat.id===input.chatId?{...chat,lastMessage:input.body,lastMessageDirection:'out',updatedAt:message.sentAt}:chat)};return message.id;},
  updateMessageDelivery(id,patch){const messages=outreachState.messages.map(message=>message.id===id?{...message,...patch}:message);outreachState={...outreachState,messages,messagesByChatId:Object.fromEntries(outreachState.chats.map(chat=>[chat.id,messages.filter(message=>message.chatId===chat.id)]))};},
  listRetryableOutgoing(){return outreachState.messages;},
  setDraftReply(value){outreachState={...outreachState,draftReply:value};},pushToast(){},
 };
 return {api,get state(){return outreachState;},get calls(){return calls;},advance(ms){now+=ms;},get now(){return now;},gate(value){fetchGate=value;},fail(value){networkFailure=value;},close(){globalThis.outreachQueueCleanup?.();globalThis.outreachQueueCleanup=undefined;Date.now=original.now;globalThis.fetch=original.fetch;globalThis.window=original.window;api.stopAiOutreach();}};
}

test('proactive generation uses the folder account, durably queues once and preserves the human draft',async()=>{
 const h=await fixture();try{
  await h.api.tickAiOutreach();assert.equal(h.calls,1);assert.equal(h.state.settings.aiOutreachRuns[0].status,'queued');
  const message=h.state.messages[0];assert.equal(message.accountId,'a');assert.equal(message.systemKind,'ai_proactive');assert.equal(h.state.draftReply,'UNSENT HUMAN DRAFT');
  assert.ok(h.api.currentOutreachContext(h.state,message));
  assert.ok(outreachCheckpoints.some(checkpoint=>checkpoint.messages[0]?.deliveryStatus==='pending'&&checkpoint.runs[0]?.messageId===message.id),'run checkpoint precedes queued delivery');
  h.advance(60_000);await h.api.tickAiOutreach();assert.equal(h.calls,1);assert.equal(h.state.messages.length,1);
 }finally{h.close();}
});

test('cross-account outreach uses the last successfully contacted account and never substitutes another member when it is out of scope',async()=>{
 for(const includeLatest of [true,false])for(const coldHistory of [true,false]){
  const h=await fixture('auto','daily');try{
   const first=h.state.chats[0];first.hasMessageHistory=true;first.lastMessage='Previous A';first.lastMessageDirection='out';first.updatedAt='2026-11-05T08:00:00Z';
   h.state.contacts.push({...h.state.contacts[0],id:'person-b',accountId:'b'});
   h.state.chats.push({...first,id:'chat-b',contactId:'person-b',accountId:'b',phoneId:'b',lastMessage:'Previous B',updatedAt:'2026-11-05T10:00:00Z'});
   h.state.settings.chatFolders[0].scope={type:'all'};if(includeLatest)h.state.settings.chatFolders[0].chatIds.push('chat-b');
   h.state.settings.activeAccountId='a';h.state.settings.liveBaileysAccountId='a';
   const a={id:'a-old',chatId:'chat',accountId:'a',contactId:'person',direction:'out',body:'Previous A',deliveryStatus:'sent',sentAt:first.updatedAt};
   const b={...a,id:'b-new',chatId:'chat-b',accountId:'b',contactId:'person-b',body:'Previous B',sentAt:'2026-11-05T10:00:00Z'};
   h.state.messages=[a,b];h.state.messagesByChatId={chat:[a],'chat-b':[b]};
   if(coldHistory){h.state.chats[0].lastSuccessfulOutgoing={at:a.sentAt,accountId:'a'};h.state.chats[1].lastSuccessfulOutgoing={at:b.sentAt,accountId:'b'};h.state.messages=[];h.state.messagesByChatId={};}
   await h.api.tickAiOutreach();
   if(includeLatest){assert.equal(h.calls,1);assert.equal(h.state.settings.aiOutreachRuns[0].accountId,'b');assert.equal(h.state.settings.aiOutreachRuns[0].chatId,'chat-b');assert.equal(h.state.messages.at(-1).accountId,'b');}
   else{assert.equal(h.calls,0);assert.equal(h.state.settings.aiOutreachRuns.length,0);}
  }finally{h.close();}
 }
});

test('backup parsing preserves validated successful-sender metadata and rejects malformed summaries',async()=>{
 const h=await fixture();try{
  const chats=h.state.chats.map(chat=>({...chat,lastSuccessfulOutgoing:{at:'2026-11-05T10:00:00Z',accountId:'a'}}));
  const restored=h.api.parseBackupJson({version:2,contacts:h.state.contacts,chats,settingsSafe:h.api.buildSettingsSafe(h.state.settings)});
  assert.deepEqual(restored.chats[0].lastSuccessfulOutgoing,{at:'2026-11-05T10:00:00.000Z',accountId:'a'});
  chats[0].lastSuccessfulOutgoing.at='not a date';assert.equal(h.api.parseBackupJson({version:2,contacts:h.state.contacts,chats}).chats[0].lastSuccessfulOutgoing,undefined);
 }finally{h.close();}
});

test('draft confirmation reuses generated text, and double confirmation never creates duplicate messages',async()=>{
 const h=await fixture('draft');try{
  await h.api.tickAiOutreach();assert.equal(h.state.messages.length,0);const run=h.state.settings.aiOutreachRuns[0];assert.equal(run.status,'draft');
  assert.deepEqual(await Promise.all([h.api.queueOutreachDraft(run.id),h.api.queueOutreachDraft(run.id)]),[true,false]);
  assert.equal(h.calls,1);assert.equal(h.state.messages.length,1);assert.equal(h.state.settings.aiOutreachRuns[0].approved,true);assert.ok(h.api.currentOutreachContext(h.state,h.state.messages[0]));
 }finally{h.close();}
});

test('folder pause preserves a queued message and resume reuses its text without a second AI request',async()=>{
 const h=await fixture();try{
  await h.api.tickAiOutreach();const message=h.state.messages[0],key=h.api.currentOutreachContext(h.state,message);
  h.state.settings.chatFolders[0].aiOutreach.paused=true;
  h.api.SendQueueWatcher();await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(outreachSent.length,0);assert.equal(h.state.messages[0].deliveryStatus,'queued');
  assert.equal(h.state.settings.aiOutreachRuns[0].status,'queued');
  globalThis.outreachQueueCleanup?.();globalThis.outreachQueueCleanup=undefined;
  h.state.settings.chatFolders[0].aiOutreach.paused=false;
  assert.equal(h.api.currentOutreachContext(h.state,h.state.messages[0]),key);
  h.api.SendQueueWatcher();await new Promise(resolve=>setTimeout(resolve,30));
  assert.equal(outreachSent.length,1);assert.equal(h.calls,1);assert.equal(h.state.messages.length,1);
 }finally{h.close();}
});

test('paused drafts stay drafts, and pausing a folder prevents new AI generation',async()=>{
 const h=await fixture('draft');try{
  await h.api.tickAiOutreach();const run=h.state.settings.aiOutreachRuns[0];h.state.settings.chatFolders[0].aiOutreach.paused=true;
  assert.equal(await h.api.queueOutreachDraft(run.id),false);assert.equal(h.state.settings.aiOutreachRuns[0].status,'draft');
  assert.equal(h.calls,1);assert.equal(h.state.messages.length,0);
  const restored=h.api.normalizeLoadedSettings(h.state.settings);assert.equal(restored.chatFolders[0].aiOutreach.paused,true);
 }finally{h.close();}
 const paused=await fixture();try{paused.state.settings.chatFolders[0].aiOutreach.paused=true;await paused.api.tickAiOutreach();assert.equal(paused.calls,0);}finally{paused.close();}
});

test('outreach master pause and person exclusion retain queued messages, do not alter replies, and resume without another model call',async()=>{
 for(const kind of ['master','person']){
  const h=await fixture();try{
   await h.api.tickAiOutreach();const key=h.api.currentOutreachContext(h.state,h.state.messages[0]);
   if(kind==='master')h.state.settings.aiOutreachPaused=true;else h.state.settings.aiOutreachExcludedRecipients=[':12025550101'];
   h.api.SendQueueWatcher();await new Promise(resolve=>setTimeout(resolve,25));assert.equal(outreachSent.length,0);assert.equal(h.state.messages[0].deliveryStatus,'queued');assert.equal(h.state.settings.aiReplyMode,'semi');assert.equal(h.state.settings.aiAutoReplyPaused,false);
   globalThis.outreachQueueCleanup?.();globalThis.outreachQueueCleanup=undefined;
   h.state.settings.aiOutreachPaused=false;h.state.settings.aiOutreachExcludedRecipients=[];assert.equal(h.api.currentOutreachContext(h.state,h.state.messages[0]),key);
   h.api.SendQueueWatcher();await new Promise(resolve=>setTimeout(resolve,25));assert.equal(outreachSent.length,1);assert.equal(h.calls,1);
  }finally{h.close();}
 }
});

test('instructions alone cannot activate outreach, but an enabled schedule can use the folder prompt without an extra goal',async()=>{
 const h=await fixture();try{
  h.state.settings.chatFolders[0].aiOutreach.goal='';h.state.settings.chatFolders[0].aiOutreach.enabled=false;
  await h.api.tickAiOutreach();assert.equal(h.calls,0);
  h.state.settings.chatFolders[0].aiOutreach.enabled=true;h.state.settings.aiOutreachPaused=true;h.advance(31_000);await h.api.tickAiOutreach();assert.equal(h.calls,0);
  h.state.settings.aiOutreachPaused=false;h.advance(31_000);await h.api.tickAiOutreach();assert.equal(h.calls,1);assert.equal(h.state.settings.aiOutreachRuns[0].status,'queued');
 }finally{h.close();}
});

test('manual inbound reply mode does not disable an explicitly configured outreach schedule',async()=>{
 const h=await fixture();try{
  h.state.settings.chatFolders[0].autoReplyMode='manual';h.state.settings.aiAutoReplyModeByChatId={chat:'manual'};
  await h.api.tickAiOutreach();assert.equal(h.calls,1);assert.equal(h.state.settings.aiOutreachRuns[0].status,'queued');assert.equal(h.state.settings.aiAutoReplyModeByChatId.chat,'manual');
 }finally{h.close();}
});

test('outreach controls survive reload, exclusions reject malformed values and backup restore pauses outreach',async()=>{
 const h=await fixture();try{
  const settings=h.api.normalizeLoadedSettings({...h.state.settings,aiOutreachPaused:true,aiOutreachExcludedRecipients:[':12025550101',':12025550101',null,12,'x'.repeat(241)]});
  assert.deepEqual(settings.aiOutreachExcludedRecipients,[':12025550101']);assert.equal(h.api.normalizeLoadedSettings(JSON.parse(JSON.stringify(settings))).aiOutreachPaused,true);
  const backup=h.api.parseBackupJson({version:2,contacts:h.state.contacts,settingsSafe:h.api.buildSettingsSafe({...settings,aiOutreachPaused:false})});
  const restored=h.api.normalizeLoadedSettings(backup.settingsSafe);assert.equal(restored.aiOutreachPaused,true);assert.deepEqual(restored.aiOutreachExcludedRecipients,[':12025550101']);assert.equal(restored.chatFolders[0].aiOutreach.enabled,false);
 }finally{h.close();}
});

test('preview shares real eligibility and stays read-only with no model requests, tasks or outgoing messages',async()=>{
 const h=await fixture();try{
  const before=JSON.stringify(h.state),preview=await h.api.buildOutreachPreview(h.state,['folder'],h.now);
  assert.equal(preview.eligible,1);assert.equal(preview.readyNow,1);assert.equal(preview.rows[0].accountId,'a');assert.equal(preview.rows[0].reason,'ready');assert.equal(h.api.inspectOutreachCandidate(h.state,'folder','chat',h.now).reason,'ready');
  assert.equal(JSON.stringify(h.state),before);assert.equal(h.calls,0);assert.equal(outreachSent.length,0);
 }finally{h.close();}
});

test('preview before enabling can estimate future eligibility without lifting the actual master pause',async()=>{
 const h=await fixture();try{
  h.advance(-75*60_000);h.state.settings.aiOutreachPaused=true;
  const stopped=await h.api.buildOutreachPreview(h.state,['folder'],h.now);assert.equal(stopped.eligible,0);assert.equal(stopped.rows[0].reason,'master_paused');
  const active=await h.api.buildOutreachPreview(h.state,['folder'],h.now,{assumeRunning:true});assert.equal(active.eligible,1);assert.equal(active.readyNow,0);assert.equal(active.rows[0].reason,'not_time');assert.equal(active.nextAt,Date.parse('2026-11-06T09:00:00Z'));
  assert.equal(h.state.settings.aiOutreachPaused,true);assert.equal(h.calls,0);
 }finally{h.close();}
});

test('preview retains same-chat task checks after the contact changes phone number',async()=>{
 const h=await fixture();try{
  h.state.settings.aiOutreachRuns=[{id:'existing',folderId:'folder',chatId:'chat',accountId:'a',recipient:'+12025550999',day:'2026-11-06',at:new Date(h.now).toISOString(),status:'queued'}];
  const result=await h.api.buildOutreachPreview(h.state,['folder'],h.now);
  assert.equal(result.rows[0].reason,h.api.inspectOutreachCandidate(h.state,'folder','chat',h.now).reason);
  assert.equal(result.rows[0].reason,'already_contacted');assert.equal(result.eligible,0);assert.equal(h.calls,0);
 }finally{h.close();}
});

test('preview explains real blockers instead of silently reporting an empty task list',async()=>{
 const changes=[['offline',h=>h.state.settings.waAccounts[0].status='disconnected'],['person_excluded',h=>h.state.settings.aiOutreachExcludedRecipients=[':12025550101']],['missing_prompt',h=>h.state.settings.aiSystemPrompt=''],['unknown_history',h=>delete h.state.chats[0].hasMessageHistory],['delivery_pending',h=>{h.state.messagesByChatId.chat=[{id:'unsent',chatId:'chat',direction:'out',sentAt:h.state.chats[0].updatedAt,body:'Pending',deliveryStatus:'queued'}];}]];
 for(const [reason,change] of changes){const h=await fixture();try{change(h);const result=await h.api.buildOutreachPreview(h.state,['folder'],h.now);assert.equal(result.rows[0].reason,reason);assert.equal(result.eligible,0);assert.equal(h.calls,0);}finally{h.close();}}
});

test('preview counts each person once, enforces daily limits across projected rows and excludes unrelated folder members',async()=>{
 const h=await fixture();try{
  h.state.settings.chatFolders[0].aiOutreach.dailyLimit=1;
  for(let i=1;i<=2;i++){h.state.contacts.push({...h.state.contacts[0],id:'person-'+i,phone:'+1202555010'+(i+1)});h.state.chats.push({...h.state.chats[0],id:'chat-'+i,contactId:'person-'+i});h.state.settings.chatFolders[0].chatIds.push('chat-'+i);}
  h.state.contacts.push({...h.state.contacts[0],id:'outside-person',phone:'+12025550199'});h.state.chats.push({...h.state.chats[0],id:'outside',contactId:'outside-person'});
  const result=await h.api.buildOutreachPreview(h.state,['folder'],h.now);assert.equal(result.rows.length,3);assert.equal(result.eligible,1);assert.equal(result.quotaWaiting,2);assert.equal(result.rows.filter(row=>row.reason==='daily_limit').length,2);assert.ok(!result.rows.some(row=>row.chatId==='outside'));
  h.state.settings.chatFolders.push({...h.state.settings.chatFolders[0],id:'duplicate',chatIds:['chat']});
  const duplicated=await h.api.buildOutreachPreview(h.state,['folder','duplicate'],h.now);assert.equal(duplicated.eligible,1);assert.ok(duplicated.rows.some(row=>row.reason==='duplicate'));
 }finally{h.close();}
});

test('next check handles passed windows and both missing and repeated daylight-saving hours',async()=>{
 const h=await fixture();try{
  const utc={time:'09:00',timeZone:'UTC'};
  assert.equal(h.api.nextOutreachWindow(utc,Date.parse('2026-11-06T11:00:00Z')),Date.parse('2026-11-07T09:00:00Z'));
  const paris={time:'02:30',timeZone:'Europe/Paris'};
  assert.equal(h.api.nextOutreachWindow(paris,Date.parse('2026-03-29T00:50:00Z')),Date.parse('2026-03-29T01:00:00Z'));
  assert.equal(h.api.nextOutreachWindow(paris,Date.parse('2026-10-25T01:10:00Z')),Date.parse('2026-10-25T01:30:00Z'));
 }finally{h.close();}
});

test('preview can be cancelled between batches without generating or changing any records',async()=>{
 const h=await fixture();try{
  for(let i=1;i<=60;i++){h.state.contacts.push({...h.state.contacts[0],id:'person-'+i,phone:'+1202555'+String(i).padStart(4,'0')});h.state.chats.push({...h.state.chats[0],id:'chat-'+i,contactId:'person-'+i});h.state.settings.chatFolders[0].chatIds.push('chat-'+i);}
  const controller=new AbortController();await assert.rejects(h.api.buildOutreachPreview(h.state,['folder'],h.now,{signal:controller.signal,onProgress:()=>controller.abort()}),/abort/i);
  assert.equal(h.calls,0);assert.equal(h.state.messages.length,0);assert.equal(h.state.settings.aiOutreachRuns.length,0);
 }finally{h.close();}
});

test('a folder pause at the final transport gate retains the unsent queue item for resume',async()=>{
 const h=await fixture();try{
  await h.api.tickAiOutreach();globalThis.outreachBeforeTransport=async()=>{h.state.settings.chatFolders[0].aiOutreach.paused=true;};
  h.api.SendQueueWatcher();await new Promise(resolve=>setTimeout(resolve,30));
  assert.equal(outreachSent.length,0);assert.equal(h.state.messages[0].deliveryStatus,'queued');assert.equal(h.state.messages[0].retryCount,0);
  globalThis.outreachQueueCleanup?.();globalThis.outreachQueueCleanup=undefined;globalThis.outreachBeforeTransport=undefined;
  h.state.settings.chatFolders[0].aiOutreach.paused=false;h.advance(6000);h.api.SendQueueWatcher();await new Promise(resolve=>setTimeout(resolve,30));
  assert.equal(outreachSent.length,1);assert.equal(h.calls,1);assert.equal(h.state.messages.length,1);
 }finally{h.close();}
});

test('chat status explains configuration and connection blocks without calling AI',async()=>{
 const h=await fixture();try{
  h.state.settings.aiReplyMode='auto';const status=()=>h.api.getChatAiStatus({settings:h.state.settings,chatId:'chat',accountId:'a',connected:true,thread:[],now:h.now});
  assert.equal(status().key,'ready');h.state.settings.aiAutoReplyPaused=true;assert.equal(status().key,'paused');
  h.state.settings.aiAutoReplyPaused=false;h.state.settings.aiAutoReplyModeByChatId={chat:'manual'};assert.equal(status().key,'manual');
  h.state.settings.aiAutoReplyModeByChatId={};assert.equal(h.api.getChatAiStatus({settings:h.state.settings,chatId:'chat',accountId:'a',connected:false,thread:[]}).key,'offline');
  h.state.settings.customAiKey='';assert.equal(status().key,'missingAi');h.state.settings.customAiKey='fixture';
  h.state.settings.chatFolders[0].aiPromptTemplateId='deleted';assert.equal(status().key,'invalidPrompt');assert.equal(h.calls,0);
 }finally{h.close();}
});

test('chat status ignores old or other-account runtime and follows ordered delivery and manual takeover',async()=>{
 const h=await fixture();try{
  h.state.settings.aiReplyMode='auto';const inbound={id:'in',chatId:'chat',accountId:'a',direction:'in',body:'Bonjour',sentAt:new Date(h.now).toISOString()};
  const runtime={phase:'generating',inboundId:'in',accountId:'a'};
  const status=(thread=[inbound],active=runtime)=>h.api.getChatAiStatus({settings:h.state.settings,chatId:'chat',accountId:'a',connected:true,thread,runtime:active,now:h.now});
  assert.equal(status().key,'generating');assert.equal(status([inbound],{...runtime,accountId:'b'}).key,'ready');
  assert.equal(status([inbound],{...runtime,inboundId:'old'}).key,'ready');
  const outbound={...inbound,id:'out',direction:'out',systemKind:'ai_auto_reply',deliveryStatus:'queued'};
  assert.equal(status([inbound,outbound]).key,'queued');
  assert.equal(status([outbound,inbound]).key,'generating','same timestamp cannot make an earlier reply cover a newer inbound message');
  assert.equal(status([inbound,{...outbound,deliveryStatus:'failed',lastError:'Network'}]).reason,'Network');
  assert.equal(status([inbound,{...outbound,deliveryUncertain:true}]).key,'uncertain');
  assert.equal(status([inbound,{...outbound,deliveryStatus:'sent'}]).key,'waitingReply');
  assert.equal(status([inbound,{...outbound,systemKind:undefined,deliveryStatus:'sent'}]).key,'takeover');assert.equal(h.calls,0);
 }finally{h.close();}
});

test('disabled, paused, offline, wrong-account and cold-history contacts consume no AI request',async()=>{
 const changes=[h=>h.state.settings.chatFolders[0].aiOutreach.enabled=false,h=>h.state.settings.aiAutoReplyPaused=true,
  h=>h.state.settings.waAccounts[0].status='disconnected',h=>h.state.settings.chatFolders[0].scope.accountId='b',
  h=>h.state.chats[0].hasMessageHistory=true,h=>delete h.state.chats[0].hasMessageHistory,
  h=>h.state.settings.aiAutoReplyManualChatIds=['chat'],h=>h.state.chats[0].isGroup=true];
 for(const change of changes){const h=await fixture();try{change(h);await h.api.tickAiOutreach();assert.equal(h.calls,0);assert.equal(h.state.messages.length,0);}finally{h.close();}}
});

test('editing the prompt while generation is pending discards the old result',async()=>{
 const h=await fixture();try{
  let release;h.gate(new Promise(resolve=>release=resolve));const task=h.api.tickAiOutreach();
  while(!h.calls)await new Promise(resolve=>setImmediate(resolve));h.state.settings.aiSystemPrompt='New role';release();await task;
  assert.equal(h.state.messages.length,0);assert.equal(h.state.settings.aiOutreachRuns[0].status,'cancelled');
 }finally{h.close();}
});

test('queued proactive messages are invalidated by changed identity, membership, contact address or takeover',async()=>{
 const changes=[h=>h.state.settings.aiSystemPrompt='Changed',h=>h.state.settings.chatFolders[0].chatIds=[],
  h=>h.state.contacts[0].phone='+12025550109',h=>h.state.settings.aiAutoReplyPaused=true,
  h=>h.state.settings.chatFolders[0].aiOutreach.enabled=false,h=>h.state.chats[0].accountId='b'];
 for(const change of changes){const h=await fixture();try{await h.api.tickAiOutreach();const message=h.state.messages[0];const key=h.api.currentOutreachContext(h.state,message);assert.ok(key);change(h);assert.notEqual(h.api.currentOutreachContext(h.state,message),key);}finally{h.close();}}
});

test('new incoming messages invalidate drafts and explicit opt-out enables the existing manual takeover',async()=>{
 const h=await fixture('draft');try{
  await h.api.tickAiOutreach();const run=h.state.settings.aiOutreachRuns[0];
  const incoming={id:'incoming',chatId:'chat',contactId:'person',accountId:'a',direction:'in',sentAt:new Date(h.now+1).toISOString(),body:'Do not contact me again'};
  h.state.messages.push(incoming);h.state.messagesByChatId.chat=[incoming];h.state.chats[0]={...h.state.chats[0],updatedAt:incoming.sentAt,lastMessage:incoming.body,lastMessageDirection:'in'};
  h.api.noteOutreachOptOut([incoming]);assert.ok(h.state.settings.aiAutoReplyManualChatIds.includes('chat'));
  assert.equal(await h.api.queueOutreachDraft(run.id),false);assert.equal(h.state.messages.filter(message=>message.direction==='out').length,0);
 }finally{h.close();}
});

test('next-day contact respects idle time, unanswered inbound messages, daily caps and prior unanswered outreach',async()=>{
 const h=await fixture('draft','daily');try{
  const message={id:'manual',chatId:'chat',direction:'out',body:'Yesterday conversation',sentAt:'2026-11-05T12:00:00.000Z',deliveryStatus:'sent'};
  h.state.messages=[message];h.state.messagesByChatId.chat=[message];h.state.chats[0].lastMessage=message.body;h.state.chats[0].hasMessageHistory=true;h.state.chats[0].lastMessageDirection='out';
  assert.ok(h.api.outreachCandidate(h.state,'folder','chat',h.now));
  h.state.chats[0].replyPendingSince='2026-11-05T13:00:00Z';assert.equal(h.api.outreachCandidate(h.state,'folder','chat',h.now),null);delete h.state.chats[0].replyPendingSince;
  h.state.settings.aiOutreachRuns=[{id:'old',folderId:'folder',chatId:'chat',accountId:'a',day:'2026-11-05',at:'2026-11-05T14:00:00Z',basisAt:message.sentAt,status:'sent'}];
  assert.equal(h.api.outreachCandidate(h.state,'folder','chat',h.now),null);
 }finally{h.close();}
});

test('API failures require explicit retry, while a failed checkpoint consumes no model request',async()=>{
 const h=await fixture('draft');try{
  h.fail(true);await h.api.tickAiOutreach();const id=h.state.settings.aiOutreachRuns[0].id;assert.equal(h.state.settings.aiOutreachRuns[0].status,'failed');
  h.advance(60_000);await h.api.tickAiOutreach();assert.equal(h.calls,1);h.fail(false);
  assert.equal(await h.api.retryAiOutreach(id),true);assert.equal(h.calls,2);assert.equal(h.state.settings.aiOutreachRuns.length,1);assert.equal(h.state.settings.aiOutreachRuns[0].status,'draft');
 }finally{h.close();}
 const disk=await fixture();try{globalThis.outreachDiskError=true;await assert.rejects(disk.api.tickAiOutreach(),/disk full/);assert.equal(disk.calls,0);assert.equal(disk.state.messages.length,0);}finally{disk.close();}
});

test('prompt templates and composition survive restart and backup, while restored outreach starts disabled',async()=>{
 const h=await fixture();try{
  h.state.settings.aiPromptTemplates=[{id:'template',name:'N',prompt:'Library rule'}];h.state.settings.chatFolders[0].aiPromptMode='append';h.state.settings.chatFolders[0].aiPromptTemplateId='template';
  const loaded=h.api.normalizeLoadedSettings(JSON.parse(JSON.stringify(h.state.settings)));assert.equal(loaded.aiPromptTemplates[0].prompt,'Library rule');assert.equal(loaded.chatFolders[0].aiPromptMode,'append');
  const backup=h.api.parseBackupJson({version:2,contacts:h.state.contacts,settingsSafe:h.api.buildSettingsSafe(loaded)});
  const restored=h.api.normalizeLoadedSettings(backup.settingsSafe);assert.equal(restored.aiPromptTemplates[0].id,'template');assert.equal(restored.chatFolders[0].aiOutreach.enabled,false);
 }finally{h.close();}
});

test('extended context is the default; compact remains an explicit saved choice',async()=>{
 const h=await fixture();try{
  for(const aiContextMode of [undefined,'invalid',null])assert.equal(h.api.normalizeLoadedSettings({aiContextMode}).aiContextMode,'full');
  const compact=h.api.normalizeLoadedSettings({aiContextMode:'compact'});assert.equal(compact.aiContextMode,'compact');
  assert.equal(h.api.normalizeLoadedSettings(JSON.parse(JSON.stringify(compact))).aiContextMode,'compact');
  assert.equal(h.api.buildSettingsSafe({...compact,aiContextMode:undefined}).aiContextMode,'full');
 }finally{h.close();}
});

test('the real send queue sends to the original account with spacing and blocks prompt edits at the final dispatch gate',async()=>{
 for(const edit of [false,true]){const h=await fixture();try{
  await h.api.tickAiOutreach();if(edit)globalThis.outreachBeforeTransport=()=>{h.state.settings.aiSystemPrompt='Changed just before dispatch';};
  h.api.SendQueueWatcher();for(let i=0;i<50&&['queued','pending'].includes(h.state.messages[0].deliveryStatus);i++)await new Promise(resolve=>setTimeout(resolve,1));
  assert.equal(outreachSent.length,edit?0:1,h.state.messages[0].lastError);if(!edit){assert.equal(outreachSent[0].request.accountId,'a');assert.equal(outreachSent[0].gap,20);}
 }finally{h.close();}}
});

test('temporary disconnection keeps queued outreach on its original account without another AI call',async()=>{
 const h=await fixture();try{
  await h.api.tickAiOutreach();h.state.settings.waAccounts[0].status='disconnected';h.api.SendQueueWatcher();for(let i=0;i<20;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(outreachSent.length,0);assert.equal(h.state.messages[0].deliveryStatus,'queued');assert.equal(h.state.messages[0].accountId,'a');assert.equal(h.calls,1);
 }finally{h.close();}
});

test('combined rules cover first contact and old conversations, while multilingual opt-out is explicit',async()=>{
 const h=await fixture('draft','both');try{
  assert.ok(h.api.outreachCandidate(h.state,'folder','chat',h.now));
  h.state.chats[0]={...h.state.chats[0],hasMessageHistory:true,lastMessageDirection:'out',lastMessage:'Yesterday'};
  assert.ok(h.api.outreachCandidate(h.state,'folder','chat',h.now));
  for(const text of ['别再联系我','Do not message me again','Ne m’écris plus','Ne me contactez plus'])assert.equal(h.api.isOutreachOptOut(text),true,text);
  assert.equal(h.api.isOutreachOptOut('Non merci'),false,'polite acknowledgment alone is not a permanent opt-out');
 }finally{h.close();}
});

test('a cold next-day conversation is read from disk and can be rehydrated before delivery without regenerating',async()=>{
 const h=await fixture('auto','daily');try{
  h.state.chats[0]={...h.state.chats[0],hasMessageHistory:true,lastMessage:'Yesterday',lastMessageDirection:'out'};
  globalThis.outreachHistoryItems=[{id:'old',chatId:'chat',accountId:'a',direction:'out',deliveryStatus:'sent',body:'Yesterday',sentAt:h.state.chats[0].updatedAt}];
  await h.api.tickAiOutreach();assert.equal(h.calls,1);assert.equal(h.state.settings.aiOutreachRuns[0].status,'queued');assert.ok(h.state.messages.some(message=>message.id==='old'));
  const queued=h.state.messages.find(message=>message.systemKind==='ai_proactive');h.state.messages=[queued];h.state.messagesByChatId.chat=[queued];h.advance(60_000);
  h.api.SendQueueWatcher();for(let i=0;i<50&&!outreachSent.length;i++)await new Promise(resolve=>setTimeout(resolve,1));
  assert.equal(outreachSent.length,1);assert.equal(h.calls,1);
 }finally{h.close();}
});

test('restoring data during generation cannot recreate a task from the previous dataset',async()=>{
 const h=await fixture();try{
  let release;h.gate(new Promise(resolve=>release=resolve));const task=h.api.tickAiOutreach();
  while(!h.calls)await new Promise(resolve=>setImmediate(resolve));
  globalThis.outreachRestoreEpoch++;h.state.settings.aiOutreachRuns=[];release();await task;
  assert.equal(h.state.settings.aiOutreachRuns.length,0);assert.equal(h.state.messages.length,0);
 }finally{h.close();}
});

test('restoring during draft verification cannot revive or enqueue the old task',async t=>{
 const h=await fixture('draft');try{
  await h.api.tickAiOutreach();const run=h.state.settings.aiOutreachRuns[0];let release,waiting=false;const gate=new Promise(resolve=>release=resolve);
  const digest=crypto.subtle.digest.bind(crypto.subtle);t.mock.method(crypto.subtle,'digest',async(...args)=>{waiting=true;await gate;return digest(...args);});
  const approval=h.api.queueOutreachDraft(run.id);while(!waiting)await new Promise(resolve=>setImmediate(resolve));
  globalThis.outreachRestoreEpoch++;h.state.settings.aiOutreachRuns=[];release();assert.equal(await approval,false);
  assert.equal(h.state.settings.aiOutreachRuns.length,0);assert.equal(h.state.messages.length,0);
 }finally{h.close();}
});


test('read-only large-folder preview stays bounded under repeated load',{skip:process.env.WAP_OUTREACH_SOAK!=='1'},async t=>{
 const h=await fixture();try{
  const size=Number(process.env.WAP_OUTREACH_SIZE||2000),iterations=Number(process.env.WAP_OUTREACH_ITERATIONS||20),metrics=[];
  for(let i=1;i<size;i++){h.state.contacts.push({...h.state.contacts[0],id:'person-'+i,phone:'+1202'+String(i).padStart(7,'0')});h.state.chats.push({...h.state.chats[0],id:'chat-'+i,contactId:'person-'+i});h.state.settings.chatFolders[0].chatIds.push('chat-'+i);}
  h.state.settings.chatFolders[0].aiOutreach.dailyLimit=100;
  for(let i=0;i<iterations;i++){const start=performance.now();const result=await h.api.buildOutreachPreview(h.state,['folder'],h.now);assert.equal(result.rows.length,size);assert.equal(result.eligible,100);if(globalThis.gc)globalThis.gc();metrics.push({iteration:i,ms:Math.round(performance.now()-start),heapBytes:process.memoryUsage().heapUsed,rssBytes:process.memoryUsage().rss});}
  assert.equal(h.calls,0);assert.equal(h.state.messages.length,0);assert.equal(h.state.settings.aiOutreachRuns.length,0);
  const growth=metrics.at(-1).heapBytes-metrics[Math.min(4,metrics.length-1)].heapBytes;assert.ok(!globalThis.gc||growth<32*1024*1024,'retained heap growth stays below 32 MiB after warmup');
  t.diagnostic(JSON.stringify({kind:'outreach-preview-load',size,iterations,gc:!!globalThis.gc,growth,metrics}));
 }finally{h.close();}
});

test('immediate round opens only a temporary window and retains recipient and quota checks',async()=>{
 const h=await fixture();try{
  const rule=h.state.settings.chatFolders[0].aiOutreach;
  rule.time='23:00';
  assert.equal(h.api.inspectOutreachCandidate(h.state,'folder','chat',h.now).reason,'not_time');
  rule.runNowAt=h.now;
  assert.equal(h.api.inspectOutreachCandidate(h.state,'folder','chat',h.now).reason,'ready');
  assert.equal(h.api.nextOutreachWindow(rule,h.now),h.now);
  assert.equal(h.api.isImmediateOutreach(rule,h.now+2*3600_000),false);
  assert.equal(h.api.isImmediateOutreach(rule,h.now-1),false);
  assert.equal(h.api.normalizeOutreachRule(rule).runNowAt,h.now);
  assert.equal(rule.time,'23:00');
  h.state.settings.waAccounts[0].status='disconnected';
  assert.equal(h.api.inspectOutreachCandidate(h.state,'folder','chat',h.now).reason,'offline');
  h.state.settings.waAccounts[0].status='connected';
  rule.dailyLimit=1;
  h.state.settings.aiOutreachRuns=[{id:'other',folderId:'folder',chatId:'other',accountId:'a',day:h.api.outreachClock('UTC',h.now).day,at:new Date(h.now).toISOString(),basisAt:'',status:'sent'}];
  assert.equal(h.api.inspectOutreachCandidate(h.state,'folder','chat',h.now).reason,'daily_limit');
 }finally{h.close();}
});

test('runner starts an immediate round before the regular schedule without changing that schedule',async()=>{
 const h=await fixture();try{
  h.state.settings.chatFolders[0].aiOutreach.time='23:00';
  h.state.settings.chatFolders[0].aiOutreach.runNowAt=h.now;
  await h.api.tickAiOutreach();
  assert.equal(h.calls,1);
  assert.equal(h.api.getOutreachSchedulerStatus().phase,'waiting');
  assert.ok(h.api.getOutreachSchedulerStatus().at);
  assert.equal(h.state.settings.aiOutreachRuns[0].status,'queued');
  assert.equal(h.state.settings.chatFolders[0].aiOutreach.time,'23:00');
  assert.equal(h.state.draftReply,'UNSENT HUMAN DRAFT');
 }finally{h.close();}
});

test('late evening outreach continues after midnight under the original round day and quota',async()=>{
 const h=await fixture();try{
  const rule=h.state.settings.chatFolders[0].aiOutreach;rule.time='22:55';rule.timeZone='Europe/Paris';
  h.advance(Date.parse('2026-11-06T23:06:00Z')-h.now);
  assert.equal(h.api.outreachRunClock(rule,h.now).day,'2026-11-06');
  assert.equal(h.api.nextOutreachWindow(rule,h.now),h.now);
  assert.equal(h.api.inspectOutreachCandidate(h.state,'folder','chat',h.now).reason,'ready');
  const preview=await h.api.buildOutreachPreview(h.state,['folder'],h.now);
  assert.equal(preview.readyNow,1);
  rule.dailyLimit=1;
  h.state.settings.aiOutreachRuns=[{id:'prior',folderId:'folder',chatId:'other',accountId:'a',day:'2026-11-06',at:'2026-11-06T22:00:00Z',basisAt:'',status:'sent'}];
  assert.equal(h.api.inspectOutreachCandidate(h.state,'folder','chat',h.now).reason,'daily_limit');
  const limited=await h.api.buildOutreachPreview(h.state,['folder'],h.now);assert.equal(limited.readyNow,0);
  h.state.settings.aiOutreachRuns=[];
  await h.api.tickAiOutreach();assert.equal(h.state.settings.aiOutreachRuns[0].day,'2026-11-06');
  assert.equal(h.state.settings.aiOutreachRuns[0].status,'queued');
  assert.equal(h.api.outreachWindowOffset(rule,Date.parse('2026-11-06T23:55:00Z')),120);
  assert.equal(h.api.nextOutreachWindow(rule,Date.parse('2026-11-06T23:55:00Z')),Date.parse('2026-11-07T21:55:00Z'));
 }finally{h.close();}
});
